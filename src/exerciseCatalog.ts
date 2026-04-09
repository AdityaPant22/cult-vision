import { SupportedExerciseId } from "./types";

export interface GuidedExerciseOption {
  id: SupportedExerciseId;
  title: string;
  shortLabel: string;
  description: string;
  coachingFocus: string;
}

export const GUIDED_EXERCISE_OPTIONS: GuidedExerciseOption[] = [
  {
    id: "Squat",
    title: "Squat",
    shortLabel: "Depth + knees",
    description: "Track depth, knee line, and torso position.",
    coachingFocus: "Keep chest up and sit deeper."
  },
  {
    id: "Push-up",
    title: "Push-up",
    shortLabel: "Depth + body line",
    description: "Track elbow depth and a strong straight body line.",
    coachingFocus: "Lower with control and stay long."
  },
  {
    id: "Lunge",
    title: "Lunge",
    shortLabel: "Depth + balance",
    description: "Track split stance depth, balance, and knee line.",
    coachingFocus: "Stay tall and own the bottom position."
  },
  {
    id: "Bicep Curl",
    title: "Bicep Curl",
    shortLabel: "Elbow tuck",
    description: "Track curl height, elbow drift, and shoulder cheating.",
    coachingFocus: "Keep the elbow tucked and curl clean."
  }
];

export function isSupportedExerciseId(
  value: string | null | undefined
): value is SupportedExerciseId {
  return GUIDED_EXERCISE_OPTIONS.some((option) => option.id === value);
}
