/**
 * Inline icon set - small enough to ship as markup, so the app carries no icon
 * dependency. Every icon is decorative: the label always lives in the markup
 * around it, so they are all aria-hidden.
 */

import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
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
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The GradeSense mark: a marked-up page. */
export function LogoGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 3.4h7.2L19 9.1v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z"
        fill="currentColor"
        opacity={0.28}
      />
      <path
        d="M6 3.4h7.2L19 9.1v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path d="M13 3.6V9.3h5.6" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      <path
        d="m8.4 14.6 2.1 2.2 4.6-5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const UploadCloud = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 15.5V7.8" />
    <path d="m8.6 11 3.4-3.2 3.4 3.2" />
    <path d="M6.4 18.2A4.2 4.2 0 0 1 6.9 9.9a5.6 5.6 0 0 1 10.7-.6 3.9 3.9 0 0 1 .5 7.7" />
  </Stroke>
);

export const FilePdf = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M13.2 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.8Z" />
    <path d="M13 3.6v5.4h5.3" />
  </Stroke>
);

export const Swap = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4.5 8.5h11l-2.8-2.9" />
    <path d="M19.5 15.5h-11l2.8 2.9" />
  </Stroke>
);

export const Close = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Stroke>
);

export const Sparkle = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8l-1.7-5.4L4.9 10.7 10.3 9Z" />
    <path d="M18.6 16.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
  </Stroke>
);

export const Check = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m5.5 12.4 4.2 4.2 8.8-9.2" />
  </Stroke>
);

export const Alert = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 4.6 21 19.4H3Z" />
    <path d="M12 10v3.6M12 16.6h.01" />
  </Stroke>
);

export const Download = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 4.2v10.4" />
    <path d="m8.2 11 3.8 3.7 3.8-3.7" />
    <path d="M4.8 18.6h14.4" />
  </Stroke>
);

export const Chevron = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m9.5 5.8 6.4 6.2-6.4 6.2" />
  </Stroke>
);

export const Clock = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.4V12l3 1.9" />
  </Stroke>
);

export const Quote = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9.4 6.6C7 7.7 5.6 9.9 5.6 12.8v4.6h5v-5H7.9c0-1.9.7-3.2 2.3-4Z" />
    <path d="M18 6.6c-2.4 1.1-3.8 3.3-3.8 6.2v4.6h5v-5h-2.7c0-1.9.7-3.2 2.3-4Z" />
  </Stroke>
);

export const Cursor = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m6 4.2 12.4 6.5-5.2 1.5-1.5 5.2Z" />
    <path d="m13.6 13.6 4.6 4.6" />
  </Stroke>
);

export const Layers = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m12 4 8 4.2-8 4.2-8-4.2Z" />
    <path d="m4 13 8 4.2 8-4.2" />
  </Stroke>
);

export const Target = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" />
  </Stroke>
);

export const Plus = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 5.6v12.8M5.6 12h12.8" />
  </Stroke>
);

export const Minus = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5.6 12h12.8" />
  </Stroke>
);
