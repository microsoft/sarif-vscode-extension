# Anti Drift

### When fetching analysis...
* BEFORE: Only accept the exact match.
* NOW: Accept the most recent "intersecting" match.
  * "Intersecting" aka common ancestor. This includes the exact.
* Weakness: The intersection may be outside the page size.
  * Example: Headless commit from a long time ago.
  * Example: The remote is way ahead.

### When feeding diagnostics to VSCode...
* If an 'intersecting' analysis was found, get the `sourceFile@intersectingCommit`.
* Diff the intersecting source and current source.
* For each result, use the diff to shift the result range.

### Diff finer details
* The diff is a list of 3 types of blocks:
  * Unchanged, added, removed
* For our purposes, we see it was two types of blocks:
  * Unchanged, and changed (added + removed)
  * These are strictly alternating.
* Traverse the diff, keeping track of:
  * The left-side offset and right-side offset.
  * Optimized: Left-side offset and delta.
    * Left-side delta is used for "indexing"
	* Delta is used for shifing.
* Cases...
  * Result falls wholly within a block
    * Block is unchanged: shift the result.
	* Block is changed: result is invalid, move to the top (or remove it).
  * Result spans two or more blocks
    * If the start/end fall within unchanged blocks, it might still be valid and shiftable.
	* All other cases, probably safer to invalidate ther result.
  