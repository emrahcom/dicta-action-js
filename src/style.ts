// The CSS of the <dicta-action> element's shadow root (specs/architecture.md).

export const STYLE = `
  :host {
    display: block;
  }
  [hidden] {
    display: none !important;
  }
  .notices {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* The parts stack, the buttons last (specs/architecture.md, Display). */
  .view,
  .notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid #888;
    background: #fff;
    color: #222;
  }
  .text {
    max-width: 100%;
    overflow-wrap: anywhere;
    /* An info keeps its paragraphs. */
    white-space: pre-line;
  }
  .status {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  /* A question's options, one per line. */
  .buttons.column {
    flex-direction: column;
    align-items: flex-start;
  }
  .label:empty {
    display: none;
  }
  .indicator {
    flex: none;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    border: 2px solid #888;
    border-top-color: #1a5fb4;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .indicator {
      animation: none;
    }
  }
  button {
    padding: 0.25rem 0.75rem;
    border: 1px solid #888;
    background: #fff;
    color: #222;
    font: inherit;
  }
  button:focus-visible,
  .notice:focus-visible {
    outline: 2px solid #1a5fb4;
    outline-offset: 2px;
  }
  /* For screen readers only. */
  .announcer {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;
