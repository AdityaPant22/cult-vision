import { Reducer, ReducerState, useEffect, useReducer } from "react";

export function usePersistentReducer<R extends Reducer<any, any>>(
  reducer: R,
  initialState: ReducerState<R>,
  storageKey: string
) {
  const [state, dispatch] = useReducer(reducer, initialState, (defaultState) => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        return defaultState;
      }

      return JSON.parse(stored) as ReducerState<R>;
    } catch {
      return defaultState;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  return [state, dispatch] as const;
}
