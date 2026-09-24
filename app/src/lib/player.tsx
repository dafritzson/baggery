import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import { PlayerPopup } from '@/components/player-popup';

/** Lets the popup draft a player: the draft room provides it while someone can pick. */
export interface DraftAction {
  /** "Draft", or "Draft for <team>" when the commissioner picks for someone. */
  label: string;
  canDraft: (playerId: number) => boolean;
  draft: (playerId: number) => void;
}

// Two contexts: components that only open the popup (or register the draft action) don't
// re-render when the popup opens, closes or the draft action changes.
const OpenPlayerContext = createContext<{
  open: (playerId: number) => void;
  setDraftAction: (action: DraftAction | null) => void;
}>({ open: () => {}, setDraftAction: () => {} });

/** Hosts the player popup, which any screen opens with `useOpenPlayer()`. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [draftAction, setDraftAction] = useState<DraftAction | null>(null);
  const [actions] = useState(() => ({ open: setPlayerId, setDraftAction }));
  return (
    <OpenPlayerContext value={actions}>
      {children}
      <PlayerPopup
        playerId={playerId}
        draftAction={draftAction}
        onClose={() => setPlayerId(null)}
      />
    </OpenPlayerContext>
  );
}

/** Opens a player's stats popup. */
export function useOpenPlayer(): (playerId: number) => void {
  return use(OpenPlayerContext).open;
}

/** Offers a Draft button in the popup while this component is mounted and `action` is set. */
export function useDraftAction(action: DraftAction | null) {
  const { setDraftAction } = use(OpenPlayerContext);
  useEffect(() => {
    setDraftAction(action);
    return () => setDraftAction(null);
  }, [action, setDraftAction]);
}
