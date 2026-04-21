// Ambient typings for the Hyperframes player web component.
// The package registers `<hyperframes-player>` as a custom element on import.

import 'react';

declare module '@hyperframes/player';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          composition?: string;
        },
        HTMLElement
      >;
    }
  }
}
