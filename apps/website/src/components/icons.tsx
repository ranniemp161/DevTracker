import type { SVGProps } from 'react';

/** Outline icons: 24×24 grid, stroke 1.8, round caps/joins. Render at 14–18px. */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const XIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.2v.1" />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18.5" cy="12" r="1" />
  </Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2.5" />
    <path d="M4 10h16M8.5 3v4M15.5 3v4" />
  </Icon>
);

export function SpinnerIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden="true"
      className="animate-spin"
      {...rest}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

/** DevTrack brand mark. `tone="mint"` is for dark surfaces. */
export function DevtrackMark({
  size = 24,
  tone = 'pine',
  title,
}: {
  size?: number;
  tone?: 'pine' | 'mint';
  title?: string;
}) {
  const bg = tone === 'pine' ? 'var(--dt-pine-600)' : 'var(--dt-pine-400)';
  const fg = tone === 'pine' ? '#ffffff' : 'var(--dt-pine-900)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="32" height="32" rx="8" fill={bg} />
      <path
        d="M11 9V23M11 9H15A7 7 0 0 1 15 23H11"
        fill="none"
        stroke={fg}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="9" r="2.3" fill={fg} />
      <circle cx="11" cy="23" r="2.3" fill={fg} />
      <circle cx="22" cy="16" r="2.4" fill={bg} stroke={fg} strokeWidth="2" />
    </svg>
  );
}
