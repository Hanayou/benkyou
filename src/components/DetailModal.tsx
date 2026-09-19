import type { StudyItem } from '../lib/types';
import { ItemDetail } from './ItemDetail';

/** Full-screen modal wrapping ItemDetail — used by search results and list rows. */
export function DetailModal({ item, onClose }: { item: StudyItem; onClose(): void }) {
  return (
    <div class="modal">
      <div class="modal-head">
        <button type="button" class="icon-btn" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <ItemDetail item={item} />
      </div>
    </div>
  );
}
