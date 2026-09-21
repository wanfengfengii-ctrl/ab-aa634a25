/// <reference lib="webworker" />
import { solve } from './solver';
import type { ProblemInput, SolveResult } from './types';

interface SolveRequest {
  id: number;
  input: ProblemInput;
}

interface SolveResponse {
  id: number;
  result: SolveResult;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (msg: SolveResponse) => void;
};

ctx.onmessage = (e) => {
  const { id, input } = e.data;
  const result = solve(input);
  ctx.postMessage({ id, result });
};
