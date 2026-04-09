import { GUIDED_EXERCISE_OPTIONS } from "../exerciseCatalog";
import { SupportedExerciseId } from "../types";

interface ExercisePickerProps {
  selectedExerciseId: SupportedExerciseId | null;
  onSelectExercise: (exerciseId: SupportedExerciseId) => void;
}

export function ExercisePicker({
  selectedExerciseId,
  onSelectExercise
}: ExercisePickerProps) {
  return (
    <div className="exercise-picker-grid" role="listbox" aria-label="Select exercise">
      {GUIDED_EXERCISE_OPTIONS.map((exercise) => {
        const isSelected = exercise.id === selectedExerciseId;

        return (
          <button
            key={exercise.id}
            className={`exercise-option ${isSelected ? "active" : ""}`}
            type="button"
            aria-selected={isSelected}
            onClick={() => onSelectExercise(exercise.id)}
          >
            <div className="exercise-option-copy">
              <span className="exercise-option-title">{exercise.title}</span>
              <span className="exercise-option-description">{exercise.description}</span>
            </div>
            <div className="exercise-option-meta">
              <span className="exercise-option-focus">{exercise.shortLabel}</span>
              <strong>{isSelected ? "Selected" : "Choose"}</strong>
            </div>
          </button>
        );
      })}
    </div>
  );
}
