import type { Pose, Keypoint } from "@tensorflow-models/pose-detection";

export interface AnalysisInput {
  id: string;
  label: string;
  url: string;
}

export interface AnalysisResult {
  id: string;
  label: string;
  exercise: "Squat" | "Push-up" | "Lunge" | "Unknown";
  overallScore: number;
  repCount: number;
  confidence: number;
  metrics: {
    rangeOfMotion: number;
    stability: number;
    tempo: number;
  };
  feedback: string[];
}

type PoseDetectionModule = typeof import("@tensorflow-models/pose-detection");
type TfModule = typeof import("@tensorflow/tfjs");

type DetectorBundle = {
  detector: import("@tensorflow-models/pose-detection").PoseDetector;
  tf: TfModule;
};

type FrameMetrics = {
  torsoAngleFromHorizontal: number | null;
  averageKneeAngle: number | null;
  averageElbowAngle: number | null;
  kneeAsymmetry: number | null;
  shoulderDrift: number | null;
};

let detectorBundlePromise: Promise<DetectorBundle> | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function stdDev(values: Array<number | null>): number {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length < 2) {
    return 0;
  }

  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance =
    valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (valid.length - 1);

  return Math.sqrt(variance);
}

function angleAtPoint(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magnitude = Math.sqrt(abx ** 2 + aby ** 2) * Math.sqrt(cbx ** 2 + cby ** 2);
  if (!magnitude) {
    return 180;
  }

  const cosine = clamp(dot / magnitude, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function midpoint(a: Keypoint, b: Keypoint): Keypoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    score: Math.min(a.score ?? 0, b.score ?? 0),
    name: "midpoint"
  };
}

function getNamedKeypoint(pose: Pose, name: string): Keypoint | null {
  const point = pose.keypoints.find((keypoint) => keypoint.name === name);
  if (!point || (point.score ?? 0) < 0.3) {
    return null;
  }

  return point;
}

function getFrameMetrics(pose: Pose): FrameMetrics {
  const leftShoulder = getNamedKeypoint(pose, "left_shoulder");
  const rightShoulder = getNamedKeypoint(pose, "right_shoulder");
  const leftHip = getNamedKeypoint(pose, "left_hip");
  const rightHip = getNamedKeypoint(pose, "right_hip");
  const leftKnee = getNamedKeypoint(pose, "left_knee");
  const rightKnee = getNamedKeypoint(pose, "right_knee");
  const leftAnkle = getNamedKeypoint(pose, "left_ankle");
  const rightAnkle = getNamedKeypoint(pose, "right_ankle");
  const leftElbow = getNamedKeypoint(pose, "left_elbow");
  const rightElbow = getNamedKeypoint(pose, "right_elbow");
  const leftWrist = getNamedKeypoint(pose, "left_wrist");
  const rightWrist = getNamedKeypoint(pose, "right_wrist");

  let torsoAngleFromHorizontal: number | null = null;
  let shoulderDrift: number | null = null;
  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);
    torsoAngleFromHorizontal =
      (Math.abs(Math.atan2(hipMid.y - shoulderMid.y, hipMid.x - shoulderMid.x)) * 180) /
      Math.PI;
    shoulderDrift = Math.abs(leftShoulder.y - rightShoulder.y);
  }

  const leftKneeAngle =
    leftHip && leftKnee && leftAnkle ? angleAtPoint(leftHip, leftKnee, leftAnkle) : null;
  const rightKneeAngle =
    rightHip && rightKnee && rightAnkle ? angleAtPoint(rightHip, rightKnee, rightAnkle) : null;
  const leftElbowAngle =
    leftShoulder && leftElbow && leftWrist
      ? angleAtPoint(leftShoulder, leftElbow, leftWrist)
      : null;
  const rightElbowAngle =
    rightShoulder && rightElbow && rightWrist
      ? angleAtPoint(rightShoulder, rightElbow, rightWrist)
      : null;

  return {
    torsoAngleFromHorizontal,
    averageKneeAngle: average([leftKneeAngle, rightKneeAngle]),
    averageElbowAngle: average([leftElbowAngle, rightElbowAngle]),
    kneeAsymmetry:
      leftKneeAngle !== null && rightKneeAngle !== null
        ? Math.abs(leftKneeAngle - rightKneeAngle)
        : null,
    shoulderDrift
  };
}

function countReps(values: Array<number | null>, lowThreshold: number, highThreshold: number): number {
  let state: "up" | "down" = "up";
  let reps = 0;

  for (const value of values) {
    if (value === null) {
      continue;
    }

    if (state === "up" && value < lowThreshold) {
      state = "down";
    } else if (state === "down" && value > highThreshold) {
      reps += 1;
      state = "up";
    }
  }

  return reps;
}

function scoreRange(minAngle: number | null, targetLow: number, targetHigh: number): number {
  if (minAngle === null) {
    return 30;
  }

  if (minAngle <= targetLow) {
    return 95;
  }

  if (minAngle >= targetHigh) {
    return 35;
  }

  const ratio = (targetHigh - minAngle) / (targetHigh - targetLow);
  return Math.round(35 + ratio * 60);
}

function scoreStability(std: number, idealMax: number, poorMax: number): number {
  if (std <= idealMax) {
    return 92;
  }

  if (std >= poorMax) {
    return 40;
  }

  const ratio = (poorMax - std) / (poorMax - idealMax);
  return Math.round(40 + ratio * 52);
}

function scoreTempo(repCount: number, signalStd: number): number {
  if (repCount <= 0) {
    return 45;
  }

  if (repCount === 1) {
    return 68;
  }

  return clamp(Math.round(88 - signalStd / 2), 55, 92);
}

function buildFeedback(
  exercise: AnalysisResult["exercise"],
  rangeScore: number,
  stabilityScore: number,
  tempoScore: number,
  repCount: number
): string[] {
  const feedback: string[] = [];

  if (repCount === 0) {
    feedback.push("Could not confidently count full repetitions. Try a clearer side view.");
  }

  if (rangeScore < 65) {
    if (exercise === "Squat") {
      feedback.push("Depth looked limited. Aim for deeper knee and hip flexion.");
    } else if (exercise === "Push-up") {
      feedback.push("Elbow bend looked shallow. Try lowering further before pressing up.");
    } else if (exercise === "Lunge") {
      feedback.push("Front-knee bend looked shallow. Try sinking lower into each rep.");
    } else {
      feedback.push("Range of motion looked limited in the detected movement.");
    }
  }

  if (stabilityScore < 65) {
    feedback.push("Movement looked unstable frame to frame. A more fixed camera angle may help.");
  }

  if (tempoScore < 65) {
    feedback.push("Rep tempo looked inconsistent. Try keeping a steadier cadence.");
  }

  if (feedback.length === 0) {
    feedback.push("Good baseline capture. Movement looks consistent enough for deeper analysis.");
  }

  return feedback;
}

function inferExercise(frameMetrics: FrameMetrics[]): AnalysisResult {
  const torsoAngles = frameMetrics.map((frame) => frame.torsoAngleFromHorizontal);
  const kneeAngles = frameMetrics.map((frame) => frame.averageKneeAngle);
  const elbowAngles = frameMetrics.map((frame) => frame.averageElbowAngle);
  const asymmetry = frameMetrics.map((frame) => frame.kneeAsymmetry);
  const shoulderDrift = frameMetrics.map((frame) => frame.shoulderDrift);

  const torsoMean = average(torsoAngles) ?? 90;
  const kneeAmplitude =
    (Math.max(...kneeAngles.filter((value): value is number => value !== null), 0) || 0) -
    (Math.min(...kneeAngles.filter((value): value is number => value !== null), 180) || 180);
  const elbowAmplitude =
    (Math.max(...elbowAngles.filter((value): value is number => value !== null), 0) || 0) -
    (Math.min(...elbowAngles.filter((value): value is number => value !== null), 180) || 180);
  const asymmetryMean = average(asymmetry) ?? 0;

  let exercise: AnalysisResult["exercise"] = "Unknown";
  let repSignal = kneeAngles;
  let repCount = 0;
  let rangeScore = 45;

  if (torsoMean < 35 && elbowAmplitude > 35) {
    exercise = "Push-up";
    repSignal = elbowAngles;
    repCount = countReps(elbowAngles, 95, 155);
    rangeScore = scoreRange(
      Math.min(...elbowAngles.filter((value): value is number => value !== null), 180),
      90,
      135
    );
  } else if (kneeAmplitude > 35 && asymmetryMean < 20) {
    exercise = "Squat";
    repSignal = kneeAngles;
    repCount = countReps(kneeAngles, 110, 160);
    rangeScore = scoreRange(
      Math.min(...kneeAngles.filter((value): value is number => value !== null), 180),
      95,
      135
    );
  } else if (kneeAmplitude > 25 && asymmetryMean >= 20) {
    exercise = "Lunge";
    repSignal = kneeAngles;
    repCount = countReps(kneeAngles, 115, 160);
    rangeScore = scoreRange(
      Math.min(...kneeAngles.filter((value): value is number => value !== null), 180),
      100,
      140
    );
  }

  const stabilityScore = scoreStability(stdDev(shoulderDrift), 6, 24);
  const tempoScore = scoreTempo(repCount, stdDev(repSignal));
  const overallScore = Math.round(rangeScore * 0.45 + stabilityScore * 0.3 + tempoScore * 0.25);
  const confidence =
    exercise === "Unknown"
      ? 0.35
      : clamp(
          Math.round(
            (Math.min(95, 45 + Math.max(kneeAmplitude, elbowAmplitude)) +
              Math.min(90, 55 + repCount * 8)) / 2
          ) / 100,
          0.35,
          0.94
        );

  return {
    id: "",
    label: "",
    exercise,
    overallScore,
    repCount,
    confidence,
    metrics: {
      rangeOfMotion: rangeScore,
      stability: stabilityScore,
      tempo: tempoScore
    },
    feedback: buildFeedback(exercise, rangeScore, stabilityScore, tempoScore, repCount)
  };
}

async function getDetector(): Promise<DetectorBundle> {
  if (!detectorBundlePromise) {
    detectorBundlePromise = Promise.all([
      import("@tensorflow/tfjs"),
      import("@tensorflow-models/pose-detection")
    ]).then(async ([tf, poseDetection]) => {
      await import("@tensorflow/tfjs-backend-webgl");

      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu");
      }

      await tf.ready();

      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        }
      );

      return { detector, tf };
    });
  }

  return detectorBundlePromise;
}

function createHiddenVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Unable to load video for analysis."));
  });
}

async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleSeeked = () => {
      video.removeEventListener("seeked", handleSeeked);
      resolve();
    };

    const handleError = () => {
      video.removeEventListener("error", handleError);
      reject(new Error("Video seek failed during analysis."));
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = timeSec;
  });
}

export async function analyzeExerciseVideo(
  input: AnalysisInput,
  onProgress?: (message: string) => void
): Promise<AnalysisResult> {
  const { detector, tf } = await getDetector();
  onProgress?.(`Loading ${input.label}`);

  const video = await createHiddenVideo(input.url);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const sampleIntervalSec = duration > 24 ? 0.4 : 0.25;
  const sampledFrames: FrameMetrics[] = [];

  for (let timeSec = 0; timeSec < duration; timeSec += sampleIntervalSec) {
    await seekVideo(video, Math.min(timeSec, Math.max(duration - 0.05, 0)));
    onProgress?.(`Analyzing ${input.label} at ${timeSec.toFixed(1)}s`);

    const poses = await detector.estimatePoses(video, {
      maxPoses: 1,
      flipHorizontal: false
    });

    if (poses[0]) {
      sampledFrames.push(getFrameMetrics(poses[0]));
    }
  }

  tf.engine().startScope();
  tf.engine().endScope();

  const summary = inferExercise(sampledFrames);
  return {
    ...summary,
    id: input.id,
    label: input.label
  };
}
