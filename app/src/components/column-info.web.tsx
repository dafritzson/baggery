import { type MouseEvent, type SyntheticEvent, useState } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { TipBubble } from '@/components/hold-tip';
import { useTheme } from '@/hooks/use-theme';

/** Keeps a tap on the icon from reaching the menu item around it, which would tick it. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** An info icon in a menu item: tapping it shows what the column is in a tip, without ticking it. */
export function ColumnInfo({ text, label }: { text: string; label: string }) {
  const theme = useTheme();
  const [box, setBox] = useState<DOMRect | null>(null);
  const open = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setBox(e.currentTarget.getBoundingClientRect());
  };
  return (
    <>
      <span
        role="button"
        aria-label={`About ${label}`}
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={open}
        style={{ display: 'inline-flex', padding: 6, margin: -6, marginLeft: 0, cursor: 'help' }}>
        <InfoIcon color={theme.textSecondary} />
      </span>
      {box && <TipBubble text={text} box={box} onClose={() => setBox(null)} />}
    </>
  );
}

/** A circled "i". */
function InfoIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={6.75} stroke={color} strokeWidth={1.5} fill="none" />
      <Path d="M8 7.25v4" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={8} cy={4.9} r={1} fill={color} />
    </Svg>
  );
}
