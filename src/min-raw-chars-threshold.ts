export function shouldSkipMinRawCharsThreshold(rawCharCount: number, threshold: number): boolean {
  return threshold > 0 && rawCharCount <= threshold;
}
