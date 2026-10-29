/** Fired whenever something opens or closes over the whole page. */
export const COVER_EVENT = 'mms:cover';

let covers = 0;

/** Whether a sheet lies over the page right now. */
export function isCovered(): boolean {
  return covers > 0;
}

/**
 * Marks the page as covered until the returned function is called. What keeps
 * moving underneath (a turning globe) can stop meanwhile: nobody sees it, and
 * every frame it draws is one the sheet on top does not get.
 */
export function coverPage(): () => void {
  covers += 1;
  window.dispatchEvent(new Event(COVER_EVENT));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    covers -= 1;
    window.dispatchEvent(new Event(COVER_EVENT));
  };
}
