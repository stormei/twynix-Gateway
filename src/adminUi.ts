export function renderAdminUi(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gateway Admin</title>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@tabler/core@latest/dist/css/tabler.min.css"
    />
    <style>
      :root {
        --tx-color-primary: #007cbb;
        --tx-color-primary-hover: #135a96;
        --tx-color-primary-strong: #0f4c81;
        --tx-color-success: #2d6a2d;
        --tx-color-danger: #c92100;
        --tx-color-warning: #9a3412;
        --tx-text-default: #111827;
        --tx-text-strong: #1f2937;
        --tx-text-muted: #4b5563;
        --tx-text-secondary: #334155;
        --tx-text-subtle: #64748b;
        --tx-text-inverse: #ffffff;
        --tx-text-danger: #8a2b2b;
        --tx-surface-1: #ffffff;
        --tx-surface-2: #fcfdff;
        --tx-surface-3: #f8fafc;
        --tx-surface-info: #eef6ff;
        --tx-surface-success: #edf8f0;
        --tx-surface-danger: #fff1f1;
        --tx-surface-warning: #f7f7f7;
        --tx-border-default: #cbd5e1;
        --tx-border-muted: #d7dee8;
        --tx-border-subtle: #e5e7eb;
        --tx-border-focus: #4c8dc5;
        --tx-border-strong: #94a3b8;
        --tx-radius-xs: 4px;
        --tx-radius-sm: 6px;
        --tx-radius-md: 10px;
        --tx-radius-lg: 12px;
        --tx-radius-pill: 999px;
        --tx-focus-ring: 0 0 0 2px rgba(76, 141, 197, 0.15);
        --tx-focus-ring-strong: 0 0 0 2px rgba(76, 141, 197, 0.25);
        --tx-shadow-card: 0 1px 2px rgba(16, 24, 40, 0.06);
        --tx-shadow-card-hover: 0 6px 16px rgba(16, 24, 40, 0.12);
        --app-header-bg: #072746;
        --app-accent: #ff9a2f;

        --tblr-body-bg: #f5f7fa;
        --tblr-bg-surface: var(--tx-surface-1);
        --tblr-bg-surface-secondary: var(--tx-surface-3);
        --tblr-border-color: var(--tx-border-subtle);
        --tblr-primary: var(--tx-color-primary-strong);
        --tblr-primary-rgb: 15, 76, 129;
        --tblr-body-color: var(--tx-text-default);
        --tblr-muted: var(--tx-text-subtle);
        --ok: #1f6b3a;
        --warn: #616161;
        --bad: var(--tx-text-danger);
      }

      body {
        min-height: 100vh;
        background: var(--tblr-body-bg);
        color: var(--tx-text-default);
        font-size: 13px;
      }

      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .login-card,
      .app-shell {
        width: min(1280px, 100%);
      }

      .login-card {
        width: min(460px, 100%);
        border: 1px solid var(--tx-border-muted);
        border-radius: var(--tx-radius-lg);
        box-shadow: var(--tx-shadow-card);
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: var(--tx-radius-pill);
        border: 1px solid rgba(0, 124, 187, 0.2);
        background: var(--tx-surface-info);
        color: #1b4f8a;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        font-size: clamp(1.65rem, 2.6vw, 2.2rem);
        line-height: 1.08;
        letter-spacing: 0;
        color: var(--tx-text-strong);
      }

      form {
        display: grid;
        gap: 14px;
      }

      .form-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      label {
        display: grid;
        gap: 4px;
        font-size: 12px;
        color: var(--tx-text-muted);
        font-weight: 600;
      }

      .app-shell {
        padding: 0;
      }

      .main {
        min-width: 0;
      }

      .app-layout {
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }

      .sidebar-card {
        position: sticky;
        top: 16px;
        background: var(--tx-surface-1);
        border: 1px solid var(--tx-border-muted);
        border-radius: var(--tx-radius-lg);
        box-shadow: var(--tx-shadow-card);
        overflow: hidden;
      }

      .sidebar-title {
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--tx-text-subtle);
        margin-bottom: 12px;
      }

      .nav-menu {
        display: grid;
        gap: 10px;
      }

      .sidebar-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 4px 18px;
        margin: -1rem -1rem 16px;
        border-bottom: 1px solid var(--tx-border-subtle);
        color: var(--tx-text-strong);
      }

      .sidebar-brand-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #072746;
        color: #ff9a2f;
        font-weight: 700;
        font-size: 0.95rem;
        border: 1px solid rgba(7, 39, 70, 0.18);
      }

      .sidebar-brand-name {
        font-size: 1.28rem;
        font-weight: 700;
        letter-spacing: -0.025em;
      }

      .sidebar-scroll {
        max-height: calc(100vh - 140px);
        overflow-y: auto;
        margin: 0 -1rem -1rem;
        padding: 0 12px 14px;
      }

      .sidebar-scroll::-webkit-scrollbar {
        width: 8px;
      }

      .sidebar-scroll::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.16);
      }

      .nav-tree-group {
        display: grid;
        gap: 4px;
      }

      .nav-tree-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 6px;
        border: 0;
        background: transparent;
        color: var(--tx-text-secondary);
        text-align: left;
        font: inherit;
        border-radius: 8px;
      }

      .nav-tree-toggle:hover {
        background: var(--tx-surface-3);
      }

      .nav-tree-chevron {
        width: 16px;
        color: var(--tx-border-strong);
        font-size: 0.72rem;
        flex: 0 0 16px;
      }

      .nav-tree-title {
        font-weight: 600;
        font-size: 0.98rem;
      }

      .nav-tree-children {
        display: grid;
        gap: 2px;
        padding: 0 0 0 18px;
        margin-left: 13px;
        border-left: 1px solid rgba(148, 163, 184, 0.22);
      }

      .nav-tree-group.collapsed .nav-tree-children {
        display: none;
      }

      .nav-menu-item {
        display: flex;
        align-items: center;
        gap: 0;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #334155;
        text-align: left;
        font: inherit;
      }

      .nav-menu-item:hover {
        background: var(--tx-surface-3);
      }

      .nav-menu-item.active {
        background: var(--tx-surface-info);
        color: var(--tx-color-primary-strong);
        box-shadow: inset 3px 0 0 var(--app-accent);
      }

      .nav-menu-text {
        display: grid;
        gap: 0;
      }

      .nav-menu-label {
        font-weight: 600;
        font-size: 0.98rem;
      }

      .stat-value {
        font-size: 1.55rem;
        font-weight: 600;
        color: var(--tx-text-strong);
      }

      .status-pill {
        display: inline-block;
        padding: 6px 10px;
        border-radius: var(--tx-radius-pill);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0;
      }

      .status-ok { border: 1px solid rgba(46, 125, 50, 0.2); background: var(--tx-surface-success); color: var(--ok); }
      .status-warn { border: 1px solid rgba(0, 0, 0, 0.08); background: var(--tx-surface-warning); color: var(--warn); }
      .status-bad { border: 1px solid rgba(217, 83, 79, 0.35); background: var(--tx-surface-danger); color: var(--bad); }

      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .hint,
      .message {
        font-size: 0.92rem;
      }

      .message.error { color: var(--bad); }
      .message.success { color: var(--ok); }

      .two-col {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .browser-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
        gap: 18px;
      }

      .tree {
        display: grid;
        gap: 8px;
      }

      .tree-node {
        border: 1px solid var(--tx-border-muted);
        border-radius: var(--tx-radius-md);
        overflow: hidden;
        background: var(--tx-surface-1);
      }

      .tree-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        color: inherit;
        background: transparent;
        text-align: left;
        border-radius: 0;
        border: 0;
      }

      .tree-row:hover {
        background: var(--tx-surface-info);
      }

      .tree-row.is-variable {
        border-left: 3px solid var(--tx-color-primary);
      }

      .tree-chevron {
        width: 22px;
        color: var(--tx-color-primary-strong);
        font-weight: 600;
        flex: 0 0 22px;
      }

      .tree-meta {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--tx-text-subtle);
        font-size: 0.82rem;
      }

      .tree-children {
        padding: 0 0 10px 16px;
        display: grid;
        gap: 6px;
      }

      .mini-pill {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: var(--tx-radius-pill);
        border: 1px solid var(--tx-border-subtle);
        background: var(--tx-surface-3);
        color: var(--tx-text-secondary);
        font-size: 12px;
      }

      .mapping-list {
        display: grid;
        gap: 10px;
      }

      .modal-backdrop-lite {
        position: fixed;
        inset: 0;
        z-index: 1050;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.45);
      }

      .modal-card-lite {
        width: min(520px, 100%);
      }

      .node-detail {
        font-size: 0.9rem;
        color: var(--tblr-muted);
      }

      .mapping-item {
        padding: 12px 14px;
        border-radius: var(--tx-radius-md);
        border: 1px solid var(--tx-border-muted);
        background: var(--tx-surface-1);
        box-shadow: var(--tx-shadow-card);
      }

      .mapping-item strong {
        display: block;
        margin-bottom: 6px;
      }

      .target-fields {
        display: grid;
        gap: 12px;
      }

      .checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox input {
        width: auto;
      }

      pre {
        margin: 0;
        padding: 14px;
        overflow: auto;
        border-radius: 12px;
        background: #f8fafc;
        color: var(--tx-text-strong);
        font-size: 0.88rem;
        border: 1px solid var(--tx-border-muted);
      }

      .navbar {
        min-height: 56px;
        padding: 0 14px;
        background: var(--app-header-bg);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        color: #e6eef5;
      }

      .navbar .container-xl {
        max-width: none;
        padding-left: 0;
        padding-right: 0;
      }

      .navbar .eyebrow {
        border: 0;
        background: transparent;
        color: var(--app-accent);
        padding: 0;
      }

      .navbar .h2,
      .navbar .text-secondary {
        color: #e6eef5 !important;
      }

      .navbar .btn {
        border-color: #3b4e5b;
        color: #e6eef5;
        background: transparent;
      }

      .navbar .btn:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      .page {
        background: var(--tblr-body-bg);
      }

      .container-xl.app-shell {
        max-width: none;
        padding: 16px !important;
      }

      .card {
        border: 1px solid var(--tx-border-muted);
        border-radius: var(--tx-radius-lg);
        background: var(--tx-surface-1);
        box-shadow: var(--tx-shadow-card);
      }

      .card .card {
        border-radius: var(--tx-radius-md);
        background: var(--tx-surface-2);
      }

      .card-header,
      .card-footer {
        border-color: var(--tx-border-subtle);
        background: var(--tx-surface-2);
      }

      .card-title,
      h2.card-title,
      h3.card-title {
        color: var(--tx-text-strong);
        font-size: 14px;
        font-weight: 700;
      }

      .text-secondary,
      .hint,
      .node-detail {
        color: var(--tx-text-subtle) !important;
      }

      .btn {
        min-height: 32px;
        border-radius: var(--tx-radius-sm);
        font-size: 13px;
        font-weight: 600;
      }

      .btn-primary {
        border-color: var(--tx-color-primary-strong);
        background: var(--tx-color-primary-strong);
        color: var(--tx-text-inverse);
      }

      .btn-primary:hover {
        border-color: var(--tx-color-primary-hover);
        background: var(--tx-color-primary-hover);
      }

      .btn-outline-primary,
      .btn-outline-secondary {
        border-color: var(--tx-border-default);
        background: var(--tx-surface-1);
        color: var(--tx-text-secondary);
      }

      .btn-outline-primary:hover,
      .btn-outline-secondary:hover {
        border-color: var(--tx-border-strong);
        background: var(--tx-surface-3);
        color: var(--tx-text-strong);
      }

      .form-control,
      .form-select {
        min-height: 32px;
        padding: 0.35rem 0.5rem;
        border: 1px solid var(--tx-border-default);
        border-radius: var(--tx-radius-sm);
        background: var(--tx-surface-1);
        color: var(--tx-text-default);
        font-size: 13px;
      }

      .form-control:focus,
      .form-select:focus {
        border-color: var(--tx-border-focus);
        box-shadow: var(--tx-focus-ring);
      }

      .form-check-input:focus {
        box-shadow: var(--tx-focus-ring-strong);
      }

      .modal-backdrop-lite {
        background: rgba(15, 23, 42, 0.42);
      }

      .modal-card-lite {
        border-radius: var(--tx-radius-lg);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
      }

      .hidden {
        display: none !important;
      }

      /* UX tightening: keep this as a compact service console, not a full dashboard shell. */
      .navbar {
        min-height: 64px;
        padding: 0 16px;
      }

      .navbar .container-xl {
        display: flex;
        align-items: center;
        gap: 16px;
        min-height: 64px;
      }

      .navbar .eyebrow {
        margin: 0 0 2px !important;
        font-size: 10px;
        letter-spacing: 0.14em;
      }

      .navbar .h2 {
        font-size: 20px;
        line-height: 1.1;
        font-weight: 700;
      }

      .navbar .text-secondary {
        font-size: 12px;
        line-height: 1.2;
        opacity: 0.82;
      }

      .navbar .btn {
        min-height: 34px;
        padding: 0 14px;
      }

      .container-xl.app-shell {
        padding: 14px 16px !important;
      }

      .app-layout {
        grid-template-columns: 224px minmax(0, 1fr);
        gap: 14px;
      }

      .sidebar-card {
        top: 14px;
        border-radius: 10px;
      }

      .sidebar-card .card-body {
        padding: 12px;
      }

      .sidebar-brand {
        gap: 10px;
        padding: 0 0 12px;
        margin: 0 0 12px;
      }

      .sidebar-brand-mark {
        width: 28px;
        height: 28px;
        font-size: 13px;
      }

      .sidebar-brand-name {
        font-size: 18px;
      }

      .sidebar-title {
        margin-bottom: 8px;
        font-size: 11px;
      }

      .sidebar-scroll {
        max-height: calc(100vh - 116px);
        margin: 0;
        padding: 0 2px 4px;
      }

      .nav-menu {
        gap: 6px;
      }

      .nav-tree-toggle {
        min-height: 30px;
        padding: 5px 6px;
      }

      .nav-tree-title,
      .nav-menu-label {
        font-size: 13px;
      }

      .nav-tree-children {
        margin-left: 8px;
        padding-left: 12px;
      }

      .nav-menu-item {
        min-height: 32px;
        padding: 7px 10px;
      }

      .main > section > .card {
        border-radius: 10px;
      }

      .main > section > .card > .card-body {
        padding: 18px;
      }

      .section-head {
        align-items: flex-start;
        margin-bottom: 14px;
      }

      .section-head p {
        font-size: 13px;
      }

      .row-cards {
        --tblr-gutter-x: 12px;
        --tblr-gutter-y: 12px;
      }

      .stat.card {
        min-height: 116px;
        border-radius: 10px;
        background: #fbfcfe;
        box-shadow: none;
      }

      .stat.card .card-body {
        padding: 16px;
      }

      .stat .card-title {
        margin-bottom: 14px;
        font-size: 13px;
      }

      .stat-value {
        font-size: 22px;
        line-height: 1.1;
      }

      .stat p {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.35;
      }

      .version-pill {
        align-self: center;
        padding: 4px 8px;
        border: 1px solid rgba(255, 255, 255, .22);
        border-radius: 999px;
        color: rgba(255, 255, 255, .78);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        white-space: nowrap;
      }

      #statusDump {
        max-height: 360px;
        padding: 12px;
        border-radius: 10px;
        font-size: 12px;
        line-height: 1.45;
      }

      #debugDump {
        max-height: 340px;
        padding: 12px;
        border-radius: 10px;
        font-size: 11px;
        line-height: 1.45;
      }

      .debug-toolbar {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(220px, 1fr) 120px auto auto;
        gap: 10px;
        align-items: end;
        margin-bottom: 12px;
      }

      .debug-toolbar label {
        display: grid;
        gap: 5px;
        margin: 0;
        color: var(--tx-muted);
        font-size: 12px;
        font-weight: 700;
      }

      .debug-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 12px;
      }

      .debug-tile {
        min-height: 88px;
        padding: 12px;
        border: 1px solid var(--tx-border-muted);
        border-radius: 8px;
        background: #fbfcfe;
      }

      .debug-tile-label {
        color: var(--tx-muted);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .debug-tile-value {
        margin-top: 8px;
        color: var(--tx-text);
        font-size: 18px;
        font-weight: 800;
      }

      .debug-tile-meta {
        margin-top: 4px;
        color: var(--tx-muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .log-list {
        max-height: 520px;
        overflow: auto;
        border: 1px solid var(--tx-border-muted);
        border-radius: 8px;
        background: #ffffff;
      }

      .log-entry {
        display: grid;
        grid-template-columns: 154px 66px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        padding: 7px 10px;
        border-bottom: 1px solid var(--tx-border-muted);
        border-left: 3px solid transparent;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        line-height: 1.35;
      }

      .log-entry:last-child {
        border-bottom: 0;
      }

      .log-entry.error { border-left-color: var(--bad); }
      .log-entry.warn { border-left-color: #d97706; }
      .log-entry.info { border-left-color: #2563eb; }
      .log-entry.debug { border-left-color: #6b7280; }

      .log-ts,
      .log-level {
        color: var(--tx-muted);
        white-space: nowrap;
      }

      .log-level {
        font-weight: 800;
        text-transform: uppercase;
      }

      .log-message {
        min-width: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }

      @media (max-width: 1100px) {
        .debug-toolbar,
        .debug-grid {
          grid-template-columns: 1fr 1fr;
        }
      }

      #tab-status > .card + .card {
        margin-top: 12px;
      }

      /* OPC UA browser: dense application explorer instead of card-based web layout. */
      #tab-browser > .card {
        background: #ffffff;
      }

      #tab-browser > .card > .card-body {
        padding: 14px;
      }

      #tab-browser .section-head {
        margin-bottom: 10px;
        padding: 0 2px;
      }

      #tab-browser .section-head p {
        display: none;
      }

      #tab-browser #refreshBrowserBtn {
        min-height: 30px;
        padding: 0 10px;
      }

      #tab-browser .browser-layout {
        grid-template-columns: minmax(520px, 1fr) 420px;
        gap: 0;
        min-height: calc(100vh - 172px);
        border: 1px solid var(--tx-border-muted);
        border-radius: 8px;
        overflow: hidden;
        background: #ffffff;
      }

      #tab-browser .browser-layout > .card {
        overflow: hidden;
        border: 0;
        border-radius: 0;
        background: #ffffff;
        box-shadow: none;
      }

      #tab-browser .browser-layout > .card + .card {
        border-left: 1px solid var(--tx-border-muted);
      }

      #tab-browser .browser-layout > .card > .card-body {
        height: 100%;
        padding: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .pane-title {
        min-height: 40px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--tx-border-subtle);
        background: #fbfcfe;
        color: var(--tx-text-strong);
        font-size: 13px;
        font-weight: 700;
      }

      #browserMessage {
        padding: 6px 10px 0;
      }

      #browserTree {
        flex: 1;
        overflow: auto;
        padding: 4px 0 10px;
        gap: 0;
        align-content: start;
        grid-auto-rows: max-content;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #tab-browser .tree-node {
        border: 0;
        border-radius: 0;
        background: transparent;
        overflow: visible;
      }

      #tab-browser .tree-row {
        min-height: 24px;
        padding: 2px 10px;
        gap: 6px;
        border-radius: 0;
        border-left: 3px solid transparent;
        font-size: 12px;
        color: #334155;
      }

      #tab-browser .tree-row:hover {
        background: #eef6ff;
      }

      #tab-browser .tree-row.is-variable {
        border-left-color: var(--tx-color-primary);
      }

      #tab-browser .tree-chevron {
        width: 16px;
        flex-basis: 16px;
        font-size: 12px;
        color: var(--tx-color-primary-strong);
        text-align: center;
      }

      #tab-browser .tree-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #tab-browser .tree-meta {
        gap: 3px;
        font-size: 10px;
        flex: 0 0 auto;
      }

      #tab-browser .tree-children {
        padding: 0 0 0 18px;
        margin-left: 16px;
        gap: 0;
        border-left: 1px solid #e1e6ec;
      }

      #tab-browser .mini-pill {
        height: 18px;
        padding: 0 5px;
        border-radius: 4px;
        background: #f7f9fb;
        font-size: 10px;
        line-height: 16px;
        white-space: nowrap;
      }

      #tab-browser .tree-row .mini-pill {
        min-width: 68px;
        justify-content: center;
      }

      #tab-browser .tree-row .mini-pill:nth-child(n+2) {
        display: none;
      }

      #tab-browser .mapping-list {
        flex: 1;
        overflow: auto;
        display: block;
        gap: 0;
        padding: 0;
      }

      #tab-browser .browser-layout > .card:nth-child(2) .section-head {
        min-height: 40px;
        margin: 0;
        padding: 9px 12px;
        border-bottom: 1px solid var(--tx-border-subtle);
        background: #fbfcfe;
      }

      #tab-browser .browser-layout > .card:nth-child(2) .section-head p {
        display: none;
      }

      #tab-browser .mapping-item {
        display: grid;
        grid-template-columns: minmax(110px, 0.45fr) minmax(0, 1fr) 72px;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 3px 8px;
        border: 0;
        border-bottom: 1px solid var(--tx-border-subtle);
        border-radius: 0;
        box-shadow: none;
        background: #ffffff;
      }

      #tab-browser .mapping-item:hover {
        background: #f8fafc;
      }

      #tab-browser .mapping-item strong {
        margin: 0;
        overflow: hidden;
        color: var(--tx-text-strong);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #tab-browser .mapping-item .hint {
        overflow: hidden;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #tab-browser .mapping-item .tree-meta {
        margin-left: 0;
        justify-content: flex-end;
        flex-wrap: nowrap;
        overflow: hidden;
      }

      #tab-browser .mapping-item .tree-meta .mini-pill {
        max-width: 72px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #tab-browser .mapping-item .tree-meta .mini-pill:nth-child(1),
      #tab-browser .mapping-item .tree-meta .mini-pill:nth-child(2),
      #tab-browser .mapping-item .tree-meta .mini-pill:nth-child(4),
      #tab-browser .mapping-item .tree-meta .mini-pill:nth-child(5) {
        display: none;
      }

      @media (max-width: 900px) {
        .app-layout {
          grid-template-columns: 1fr;
        }

        .browser-layout {
          grid-template-columns: 1fr;
        }

        .sidebar-card {
          position: static;
        }
      }
    </style>
  </head>
  <body data-bs-theme="light">
    <div class="login-shell" id="loginView">
      <div class="login-card card shadow-lg border-0">
        <div class="card-body p-4 p-md-5">
          <span class="eyebrow">Gateway Admin</span>
          <h1 class="mt-3 mb-3">Edge gateway configuration</h1>
          <p class="text-secondary mb-4">Sign in with the admin account from <code>.env</code> before changing runtime settings.</p>
        <form id="loginForm">
          <label>
            Username
            <input class="form-control" id="loginUsername" name="username" autocomplete="username" required />
          </label>
          <label>
            Password
            <input class="form-control" id="loginPassword" name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="btn btn-primary w-100" type="submit">Sign in</button>
          <div class="message text-danger" id="loginMessage"></div>
        </form>
        </div>
      </div>
    </div>

    <div class="app-shell hidden" id="appView">
      <header class="navbar navbar-expand-md d-print-none border-bottom">
        <div class="container-xl">
          <div>
            <div class="eyebrow mb-2">Admin Console</div>
            <div class="h2 mb-0" id="gatewayName">Gateway</div>
            <div class="text-secondary" id="gatewaySubtitle">Live status and runtime configuration</div>
          </div>
          <div class="d-flex gap-2 ms-auto">
            <span class="version-pill" id="appVersion">version unknown</span>
            <button class="btn btn-outline-primary" id="refreshStatusBtn" type="button">Refresh status</button>
            <button class="btn btn-outline-secondary" id="logoutBtn" type="button">Logout</button>
          </div>
        </div>
      </header>
      <div class="page">
        <div class="container-xl app-shell py-4">
          <div class="app-layout">
            <aside class="sidebar-card card">
              <div class="card-body">
                <div class="sidebar-brand">
                  <span class="sidebar-brand-mark">e</span>
                  <span class="sidebar-brand-name">gateway</span>
                </div>
                <div class="sidebar-scroll">
                <div class="sidebar-title">Navigation</div>
                <div class="nav-menu">
                  <div class="nav-tree-group" data-nav-group>
                    <button class="nav-tree-toggle" type="button" data-nav-toggle>
                      <span class="nav-tree-chevron">▾</span>
                      <span class="nav-tree-title">Overview</span>
                    </button>
                    <div class="nav-tree-children">
                      <button class="nav-menu-item active" data-tab="status" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">Status</span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div class="nav-tree-group" data-nav-group>
                    <button class="nav-tree-toggle" type="button" data-nav-toggle>
                      <span class="nav-tree-chevron">▾</span>
                      <span class="nav-tree-title">Connectivity</span>
                    </button>
                    <div class="nav-tree-children">
                      <button class="nav-menu-item" data-tab="thingsboard" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">MQTT / ThingsBoard</span>
                        </span>
                      </button>
                      <button class="nav-menu-item" data-tab="opcua" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">OPC UA</span>
                        </span>
                      </button>
                      <button class="nav-menu-item" data-tab="buffering" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">Buffering / Replay</span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div class="nav-tree-group" data-nav-group>
                    <button class="nav-tree-toggle" type="button" data-nav-toggle>
                      <span class="nav-tree-chevron">▾</span>
                      <span class="nav-tree-title">Tag Management</span>
                    </button>
                    <div class="nav-tree-children">
                      <button class="nav-menu-item" data-tab="browser" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">OPC UA Browser</span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div class="nav-tree-group" data-nav-group>
                    <button class="nav-tree-toggle" type="button" data-nav-toggle>
                      <span class="nav-tree-chevron">▾</span>
                      <span class="nav-tree-title">Administration</span>
                    </button>
                    <div class="nav-tree-children">
                      <button class="nav-menu-item" data-tab="admin" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">Security</span>
                        </span>
                      </button>
                      <button class="nav-menu-item" data-tab="backup" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">Backup / Restore</span>
                        </span>
                      </button>
                      <button class="nav-menu-item" data-tab="debug" type="button">
                        <span class="nav-menu-text">
                          <span class="nav-menu-label">Debug</span>
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </aside>
            <main class="main">
          <section id="tab-status">
            <div class="card mb-3">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">System status</h2>
                  <p class="text-secondary mb-0">Live snapshot from the running gateway process.</p>
                </div>
                <span id="overallStatus" class="status-pill status-warn">Loading</span>
              </div>
              <div class="row row-cards">
                <div class="col-sm-6 col-xl-3">
                  <div class="card stat h-100">
                    <div class="card-body">
                  <h3 class="card-title">MQTT</h3>
                  <div class="stat-value" id="mqttState">-</div>
                  <p class="text-secondary mb-0" id="mqttMeta">-</p>
                    </div>
                  </div>
                </div>
                <div class="col-sm-6 col-xl-3">
                  <div class="card stat h-100">
                    <div class="card-body">
                  <h3 class="card-title">OPC UA</h3>
                  <div class="stat-value" id="opcState">-</div>
                  <p class="text-secondary mb-0" id="opcMeta">-</p>
                    </div>
                  </div>
                </div>
                <div class="col-sm-6 col-xl-3">
                  <div class="card stat h-100">
                    <div class="card-body">
                  <h3 class="card-title">Buffered</h3>
                  <div class="stat-value" id="bufferedCount">0</div>
                  <p class="text-secondary mb-0">Messages waiting for publish</p>
                    </div>
                  </div>
                </div>
                <div class="col-sm-6 col-xl-3">
                  <div class="card stat h-100">
                    <div class="card-body">
                  <h3 class="card-title">RPC pending</h3>
                  <div class="stat-value" id="rpcPending">0</div>
                  <p class="text-secondary mb-0">Write/read commands in progress</p>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">Diagnostics</h2>
                  <p class="text-secondary mb-0">Useful when the PLC or ThingsBoard link is unstable.</p>
                </div>
              </div>
              <pre id="statusDump">{}</pre>
              </div>
            </div>
          </section>

          <section id="tab-thingsboard" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">MQTT / ThingsBoard settings</h2>
                  <p class="text-secondary mb-0">These values are saved to <code>config.json</code> and applied immediately.</p>
                </div>
              </div>
              <form id="tbForm">
                <div class="form-grid">
                  <label>
                    Device name
                    <input class="form-control" id="deviceName" required />
                  </label>
                  <label>
                    MQTT URL
                    <input class="form-control" id="tbUrl" required />
                  </label>
                  <label>
                    Access token
                    <input class="form-control" id="tbAccessToken" required />
                  </label>
                  <label>
                    Client ID
                    <input class="form-control" id="tbClientId" required />
                  </label>
                  <label>
                    QoS
                    <select class="form-select" id="tbQos">
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                  <label>
                    Log level
                    <select class="form-select" id="logLevel">
                      <option value="error">error</option>
                      <option value="warn">warn</option>
                      <option value="info">info</option>
                      <option value="debug">debug</option>
                    </select>
                  </label>
                  <label>
                    TLS CA path
                    <input class="form-control" id="tbCaPath" />
                  </label>
                  <label>
                    TLS certificate path
                    <input class="form-control" id="tbCertPath" />
                  </label>
                  <label>
                    TLS key path
                    <input class="form-control" id="tbKeyPath" />
                  </label>
                  <label>
                    Minimum write interval (ms)
                    <input class="form-control" id="writeMinIntervalMs" type="number" min="0" />
                  </label>
                  <label>
                    Flush batch size
                    <input class="form-control" id="mqttFlushBatchSize" type="number" min="1" max="10000" />
                  </label>
                  <label>
                    Flush delay (ms)
                    <input class="form-control" id="mqttFlushDelayMs" type="number" min="0" max="60000" />
                  </label>
                  <label>
                    Flush interval (ms)
                    <input class="form-control" id="mqttFlushIntervalMs" type="number" min="1000" max="3600000" />
                  </label>
                </div>
                <label class="checkbox">
                  <input id="tbRejectUnauthorized" type="checkbox" />
                  Reject unauthorized MQTT certificates
                </label>
                <div>
                  <button class="btn btn-primary" type="submit">Save MQTT / ThingsBoard</button>
                </div>
                <div class="message" id="tbMessage"></div>
              </form>
              </div>
            </div>
          </section>

          <section id="tab-opcua" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">OPC UA settings</h2>
                  <p class="text-secondary mb-0">Changing these values reconnects the gateway OPC UA client.</p>
                </div>
              </div>
              <form id="opcForm">
                <div class="form-grid">
                  <label>
                    OPC UA URL
                    <input class="form-control" id="opcUrl" required />
                  </label>
                  <label>
                    Username
                    <input class="form-control" id="opcUsername" />
                  </label>
                  <label>
                    Password
                    <input class="form-control" id="opcPassword" type="password" />
                  </label>
                  <label>
                    Sampling interval (ms)
                    <input class="form-control" id="opcSamplingMs" type="number" min="50" />
                  </label>
                  <label>
                    Security policy
                    <select class="form-select" id="opcSecurityPolicy">
                      <option value="None">None</option>
                      <option value="Basic256Sha256">Basic256Sha256</option>
                    </select>
                  </label>
                  <label>
                    Security mode
                    <select class="form-select" id="opcSecurityMode">
                      <option value="None">None</option>
                      <option value="Sign">Sign</option>
                      <option value="SignAndEncrypt">SignAndEncrypt</option>
                    </select>
                  </label>
                  <label>
                    Certificate file
                    <input class="form-control" id="opcCertificateFile" />
                  </label>
                  <label>
                    Private key file
                    <input class="form-control" id="opcPrivateKeyFile" />
                  </label>
                </div>
                <label class="checkbox">
                  <input id="opcSubscribe" type="checkbox" />
                  Enable subscription polling
                </label>
                <div>
                  <button class="btn btn-primary" type="submit">Save OPC UA</button>
                </div>
                <div class="message" id="opcMessage"></div>
              </form>
              </div>
            </div>
          </section>

          <section id="tab-buffering" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">Buffering / replay settings</h2>
                  <p class="text-secondary mb-0">Throttle persisted MQTT replay after reconnect so ThingsBoard rule chains and IoTDB are not flooded.</p>
                </div>
              </div>
              <div class="row row-cards mb-3">
                <div class="col-sm-4">
                  <div class="card stat h-100">
                    <div class="card-body">
                      <h3 class="card-title">Buffered</h3>
                      <div class="stat-value" id="bufferingBufferedCount">0</div>
                      <p class="text-secondary mb-0">Messages waiting for replay</p>
                    </div>
                  </div>
                </div>
                <div class="col-sm-4">
                  <div class="card stat h-100">
                    <div class="card-body">
                      <h3 class="card-title">Flush state</h3>
                      <div class="stat-value" id="bufferingFlushState">-</div>
                      <p class="text-secondary mb-0" id="bufferingFlushMeta">-</p>
                    </div>
                  </div>
                </div>
                <div class="col-sm-4">
                  <div class="card stat h-100">
                    <div class="card-body">
                      <h3 class="card-title">Replay rate</h3>
                      <div class="stat-value" id="bufferingReplayRate">-</div>
                      <p class="text-secondary mb-0">Approximate max replay speed</p>
                    </div>
                  </div>
                </div>
              </div>
              <form id="throttleForm">
                <div class="form-grid">
                  <label>
                    Flush batch size
                    <input class="form-control" id="throttleFlushBatchSize" type="number" min="1" max="10000" required />
                  </label>
                  <label>
                    Delay between batches (ms)
                    <input class="form-control" id="throttleFlushDelayMs" type="number" min="0" max="60000" required />
                  </label>
                  <label>
                    Background flush interval (ms)
                    <input class="form-control" id="throttleFlushIntervalMs" type="number" min="1000" max="3600000" required />
                  </label>
                </div>
                <div class="d-flex gap-2 flex-wrap">
                  <button class="btn btn-primary" type="submit">Save replay throttle</button>
                  <button class="btn btn-outline-secondary" id="throttleConservativePreset" type="button">IoTDB safe preset</button>
                  <button class="btn btn-outline-secondary" id="throttleDefaultPreset" type="button">Default preset</button>
                </div>
                <div class="message" id="throttleMessage"></div>
              </form>
              </div>
            </div>
          </section>

          <section id="tab-browser" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">OPC UA browser</h2>
                  <p class="text-secondary mb-0">Expand the server tree. Clicking a variable prompts to add it to the mapping config.</p>
                </div>
                <button class="btn btn-outline-primary" id="refreshBrowserBtn" type="button">Reload tree</button>
              </div>
              <div class="browser-layout">
                <div class="card">
                  <div class="card-body">
                  <div class="pane-title">Address space</div>
                  <div class="message" id="browserMessage"></div>
                  <div class="tree" id="browserTree"></div>
                  </div>
                </div>
                <div class="card">
                  <div class="card-body">
                  <div class="section-head">
                    <div>
                      <h3 class="card-title mb-1">Mapped tags</h3>
                      <p class="text-secondary mb-0">Existing entries saved in <code>config.json</code>.</p>
                    </div>
                  </div>
                  <div class="mapping-list" id="mappingList"></div>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </section>

          <section id="tab-admin" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">Admin security</h2>
                  <p class="text-secondary mb-0">Change the admin password. The new password is stored as a hash in <code>.env</code>.</p>
                </div>
              </div>
              <form id="passwordForm">
                <div class="form-grid">
                  <label>
                    Current password
                    <input class="form-control" id="currentPassword" type="password" autocomplete="current-password" required />
                  </label>
                  <label>
                    New password
                    <input class="form-control" id="newPassword" type="password" autocomplete="new-password" minlength="12" required />
                  </label>
                  <label>
                    Confirm new password
                    <input class="form-control" id="confirmPassword" type="password" autocomplete="new-password" minlength="12" required />
                  </label>
                </div>
                <div>
                  <button class="btn btn-primary" type="submit">Change password</button>
                </div>
                <div class="message" id="passwordMessage"></div>
              </form>
              </div>
            </div>
          </section>

          <section id="tab-backup" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">Backup / restore</h2>
                  <p class="text-secondary mb-0">Backups include the full gateway config, mappings, access token, and OPC UA credentials.</p>
                </div>
                <button class="btn btn-outline-primary" id="refreshBackupsBtn" type="button">Refresh</button>
              </div>
              <div class="row row-cards mb-3">
                <div class="col-md-6">
                  <div class="card h-100">
                    <div class="card-body">
                      <h3 class="card-title">Local file backup</h3>
                      <p class="text-secondary">Stored in the mounted gateway data volume. A rollback backup is created before every restore.</p>
                      <div class="d-flex gap-2 flex-wrap">
                        <button class="btn btn-primary" id="createLocalBackupBtn" type="button">Create local backup</button>
                        <button class="btn btn-outline-primary" id="createRedactedLocalBackupBtn" type="button">Create redacted export</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="col-md-6">
                  <div class="card h-100">
                    <div class="card-body">
                      <h3 class="card-title">ThingsBoard backup</h3>
                      <p class="text-secondary">Pushes or pulls the full config as ThingsBoard client attributes on this gateway device.</p>
                      <div class="d-flex gap-2 flex-wrap">
                        <button class="btn btn-primary" id="pushTbBackupBtn" type="button">Push to ThingsBoard</button>
                        <button class="btn btn-outline-primary" id="restoreTbBackupBtn" type="button">Restore from ThingsBoard</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="card mb-3">
                <div class="card-body">
                  <h3 class="card-title">Restore uploaded JSON</h3>
                  <p class="text-secondary">Use a local backup file or a raw config JSON export.</p>
                  <div class="d-flex gap-2 flex-wrap align-items-center">
                    <input class="form-control" id="backupUploadFile" type="file" accept="application/json,.json" style="max-width: 420px" />
                    <button class="btn btn-outline-primary" id="restoreUploadBackupBtn" type="button">Restore uploaded JSON</button>
                  </div>
                </div>
              </div>
              <div class="message mb-3" id="backupMessage"></div>
              <h3 class="card-title mb-2">Local backups</h3>
              <div class="mapping-list" id="backupList"></div>
              </div>
            </div>
          </section>

          <section id="tab-debug" class="hidden">
            <div class="card">
              <div class="card-body">
              <div class="section-head">
                <div>
                  <h2 class="card-title mb-1">Debug console</h2>
                  <p class="text-secondary mb-0">Runtime diagnostics and recent redacted logs from this gateway process.</p>
                </div>
              </div>
              <div class="debug-toolbar">
                <label>
                  Level
                  <select class="form-select" id="debugLogLevel">
                    <option value="all">All levels</option>
                    <option value="error">error</option>
                    <option value="warn">warn</option>
                    <option value="info">info</option>
                    <option value="debug">debug</option>
                  </select>
                </label>
                <label>
                  Search
                  <input class="form-control" id="debugLogSearch" placeholder="message, device, endpoint, request id..." />
                </label>
                <label>
                  Limit
                  <select class="form-select" id="debugLogLimit">
                    <option value="100">100</option>
                    <option value="200" selected>200</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                  </select>
                </label>
                <button class="btn btn-outline-primary" id="refreshDebugBtn" type="button">Refresh</button>
                <button class="btn btn-outline-secondary" id="copyDebugBtn" type="button">Copy JSON</button>
              </div>
              <div class="message" id="debugMessage"></div>
              <div class="debug-grid" id="debugSummary"></div>
              <div class="row row-cards">
                <div class="col-lg-7">
                  <h3 class="card-title mb-2">Recent logs</h3>
                  <div class="log-list" id="logList"></div>
                </div>
                <div class="col-lg-5">
                  <h3 class="card-title mb-2">Diagnostics JSON</h3>
                  <pre id="debugDump">{}</pre>
                </div>
              </div>
              </div>
            </div>
          </section>
        </main>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-backdrop-lite hidden" id="addTagModal" aria-hidden="true">
      <div class="card modal-card-lite">
        <form id="addTagForm">
          <div class="card-header">
            <h3 class="card-title mb-0">Add tag to config</h3>
            <button type="button" class="btn-close" id="closeAddTagModal" aria-label="Close"></button>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <div class="node-detail" id="selectedNodeInfo"></div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="addTagKey">Key</label>
              <input class="form-control" id="addTagKey" required />
            </div>
            <div class="mb-3">
              <label class="form-label" for="addTagTargetMode">Target mode</label>
              <select class="form-select" id="addTagTargetMode">
                <option value="gateway-device">Gateway device</option>
                <option value="mapped-device">Mapped ThingsBoard device</option>
              </select>
            </div>
            <div class="target-fields" id="mappedDeviceFields">
              <div>
                <label class="form-label" for="addTagTargetDeviceName">Target ThingsBoard device name</label>
                <input class="form-control" id="addTagTargetDeviceName" />
              </div>
              <div>
                <label class="form-label" for="addTagTargetDeviceId">Target ThingsBoard device ID</label>
                <input class="form-control" id="addTagTargetDeviceId" />
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="addTagTelemetryKey">Telemetry key</label>
              <input class="form-control" id="addTagTelemetryKey" required />
            </div>
            <div class="mb-3">
              <label class="form-label" for="addTagType">Data type</label>
              <select class="form-select" id="addTagType">
                <option value="Boolean">Boolean</option>
                <option value="Int16">Int16</option>
                <option value="UInt16">UInt16</option>
                <option value="Int32">Int32</option>
                <option value="UInt32">UInt32</option>
                <option value="Float">Float</option>
                <option value="Double">Double</option>
                <option value="String">String</option>
              </select>
            </div>
            <label class="form-check">
              <input class="form-check-input" id="addTagWritable" type="checkbox" />
              <span class="form-check-label">Writable tag</span>
            </label>
            <div class="message mt-3" id="addTagMessage"></div>
          </div>
          <div class="card-footer d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-outline-secondary" id="cancelAddTagModal">Cancel</button>
            <button type="submit" class="btn btn-primary">Add tag</button>
          </div>
        </form>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/@tabler/core@latest/dist/js/tabler.min.js"></script>

    <script>
      const state = {
        authenticated: false,
        authExpired: false,
        config: null,
        status: null,
        browserNodes: new Map(),
        browserChildren: new Map(),
        browserExpanded: new Set(),
        browserLoading: new Set(),
        selectedBrowserNode: null,
        debug: null,
        backups: null
      };

      const els = {
        loginView: document.getElementById('loginView'),
        appView: document.getElementById('appView'),
        loginForm: document.getElementById('loginForm'),
        loginUsername: document.getElementById('loginUsername'),
        loginPassword: document.getElementById('loginPassword'),
        loginMessage: document.getElementById('loginMessage'),
        logoutBtn: document.getElementById('logoutBtn'),
        refreshStatusBtn: document.getElementById('refreshStatusBtn'),
        gatewayName: document.getElementById('gatewayName'),
        gatewaySubtitle: document.getElementById('gatewaySubtitle'),
        appVersion: document.getElementById('appVersion'),
        overallStatus: document.getElementById('overallStatus'),
        mqttState: document.getElementById('mqttState'),
        mqttMeta: document.getElementById('mqttMeta'),
        opcState: document.getElementById('opcState'),
        opcMeta: document.getElementById('opcMeta'),
        bufferedCount: document.getElementById('bufferedCount'),
        rpcPending: document.getElementById('rpcPending'),
        statusDump: document.getElementById('statusDump'),
        tbForm: document.getElementById('tbForm'),
        opcForm: document.getElementById('opcForm'),
        throttleForm: document.getElementById('throttleForm'),
        passwordForm: document.getElementById('passwordForm'),
        tbMessage: document.getElementById('tbMessage'),
        opcMessage: document.getElementById('opcMessage'),
        throttleMessage: document.getElementById('throttleMessage'),
        throttleConservativePreset: document.getElementById('throttleConservativePreset'),
        throttleDefaultPreset: document.getElementById('throttleDefaultPreset'),
        bufferingBufferedCount: document.getElementById('bufferingBufferedCount'),
        bufferingFlushState: document.getElementById('bufferingFlushState'),
        bufferingFlushMeta: document.getElementById('bufferingFlushMeta'),
        bufferingReplayRate: document.getElementById('bufferingReplayRate'),
        passwordMessage: document.getElementById('passwordMessage'),
        backupMessage: document.getElementById('backupMessage'),
        backupList: document.getElementById('backupList'),
        refreshBackupsBtn: document.getElementById('refreshBackupsBtn'),
        createLocalBackupBtn: document.getElementById('createLocalBackupBtn'),
        createRedactedLocalBackupBtn: document.getElementById('createRedactedLocalBackupBtn'),
        pushTbBackupBtn: document.getElementById('pushTbBackupBtn'),
        restoreTbBackupBtn: document.getElementById('restoreTbBackupBtn'),
        backupUploadFile: document.getElementById('backupUploadFile'),
        restoreUploadBackupBtn: document.getElementById('restoreUploadBackupBtn'),
        browserMessage: document.getElementById('browserMessage'),
        browserTree: document.getElementById('browserTree'),
        mappingList: document.getElementById('mappingList'),
        refreshBrowserBtn: document.getElementById('refreshBrowserBtn'),
        addTagForm: document.getElementById('addTagForm'),
        addTagKey: document.getElementById('addTagKey'),
        addTagTargetMode: document.getElementById('addTagTargetMode'),
        addTagTargetDeviceName: document.getElementById('addTagTargetDeviceName'),
        addTagTargetDeviceId: document.getElementById('addTagTargetDeviceId'),
        addTagTelemetryKey: document.getElementById('addTagTelemetryKey'),
        addTagType: document.getElementById('addTagType'),
        addTagWritable: document.getElementById('addTagWritable'),
        addTagMessage: document.getElementById('addTagMessage'),
        selectedNodeInfo: document.getElementById('selectedNodeInfo'),
        addTagModal: document.getElementById('addTagModal'),
        closeAddTagModal: document.getElementById('closeAddTagModal'),
        cancelAddTagModal: document.getElementById('cancelAddTagModal'),
        debugMessage: document.getElementById('debugMessage'),
        debugSummary: document.getElementById('debugSummary'),
        debugDump: document.getElementById('debugDump'),
        logList: document.getElementById('logList'),
        debugLogLevel: document.getElementById('debugLogLevel'),
        debugLogSearch: document.getElementById('debugLogSearch'),
        debugLogLimit: document.getElementById('debugLogLimit'),
        refreshDebugBtn: document.getElementById('refreshDebugBtn'),
        copyDebugBtn: document.getElementById('copyDebugBtn')
      };

      function syncTargetModeFields() {
        const mapped = els.addTagTargetMode.value === 'mapped-device';
        document.getElementById('mappedDeviceFields').classList.toggle('hidden', !mapped);
      }

      function showAddTagModal() {
        els.addTagModal.classList.remove('hidden');
        els.addTagModal.setAttribute('aria-hidden', 'false');
      }

      function hideAddTagModal() {
        els.addTagModal.classList.add('hidden');
        els.addTagModal.setAttribute('aria-hidden', 'true');
      }

      const tabButtons = Array.from(document.querySelectorAll('[data-tab]'));
      const navToggles = Array.from(document.querySelectorAll('[data-nav-toggle]'));
      const tabSections = {
        status: document.getElementById('tab-status'),
        thingsboard: document.getElementById('tab-thingsboard'),
        opcua: document.getElementById('tab-opcua'),
        buffering: document.getElementById('tab-buffering'),
        browser: document.getElementById('tab-browser'),
        admin: document.getElementById('tab-admin'),
        backup: document.getElementById('tab-backup'),
        debug: document.getElementById('tab-debug')
      };

      function setMessage(el, text, type) {
        el.textContent = text || '';
        el.className =
          'message' +
          (type === 'error' ? ' text-danger' : type === 'success' ? ' text-success' : '');
      }

      class AuthExpiredError extends Error {
        constructor() {
          super('Session expired. Sign in again before saving settings.');
          this.name = 'AuthExpiredError';
        }
      }

      async function api(path, options) {
        const response = await fetch(path, {
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(options && options.headers ? options.headers : {}) },
          ...options
        });
        if (response.status === 204) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 && path !== '/api/login') {
            expireSession();
            throw new AuthExpiredError();
          }
          throw new Error(data.error || ('Request failed: ' + response.status));
        }
        return data;
      }

      function expireSession() {
        state.authenticated = false;
        state.authExpired = true;
        state.config = null;
        state.status = null;
        state.debug = null;
        state.backups = null;
        showLogin();
        setMessage(els.loginMessage, 'Session expired. Sign in again before saving settings.', 'error');
      }

      function showLogin() {
        els.loginView.classList.remove('hidden');
        els.appView.classList.add('hidden');
      }

      function showApp() {
        els.loginView.classList.add('hidden');
        els.appView.classList.remove('hidden');
      }

      function renderVersion(info) {
        if (!info) return;
        els.appVersion.textContent = info.label || ((info.version || 'unknown') + '+' + (info.buildSha || 'local'));
        els.appVersion.title = 'Gateway version ' + els.appVersion.textContent;
      }

      async function ensureConfigLoaded(messageEl) {
        if (!state.authenticated) {
          throw new AuthExpiredError();
        }
        if (!state.config) {
          await loadConfig();
        }
        if (!state.config) {
          throw new Error('Config is not loaded. Sign in again and wait for the settings to load.');
        }
        const next = structuredClone(state.config);
        next.tb = next.tb || {};
        next.opcua = next.opcua || {};
        next.mapping = Array.isArray(next.mapping) ? next.mapping : [];
        return next;
      }

      function activateTab(tab) {
        if (!state.authenticated && tab !== 'status') {
          showLogin();
          return;
        }
        for (const button of tabButtons) {
          const active = button.dataset.tab === tab;
          button.classList.toggle('active', active);
        }
        for (const [key, section] of Object.entries(tabSections)) {
          section.classList.toggle('hidden', key !== tab);
        }
        if (tab === 'debug') {
          loadDebug().catch((error) => setMessage(els.debugMessage, error.message, 'error'));
        }
        if (tab === 'backup') {
          loadBackups().catch((error) => setMessage(els.backupMessage, error.message, 'error'));
        }
      }

      function bindNavTree() {
        for (const toggle of navToggles) {
          toggle.addEventListener('click', () => {
            const group = toggle.closest('[data-nav-group]');
            if (!group) return;
            group.classList.toggle('collapsed');
            const chevron = toggle.querySelector('.nav-tree-chevron');
            if (chevron) {
              chevron.textContent = group.classList.contains('collapsed') ? '▸' : '▾';
            }
          });
        }
      }

      function renderConfig() {
        const cfg = state.config;
        if (!cfg) return;
        els.gatewayName.textContent = cfg.deviceName || 'Gateway';
        els.gatewaySubtitle.textContent = 'Editing live runtime configuration';

        document.getElementById('deviceName').value = cfg.deviceName || '';
        document.getElementById('tbUrl').value = cfg.tb.url || '';
        document.getElementById('tbAccessToken').value = cfg.tb.accessToken || '';
        document.getElementById('tbClientId').value = cfg.tb.clientId || '';
        document.getElementById('tbQos').value = String(cfg.tb.qos ?? 1);
        document.getElementById('logLevel').value = cfg.logLevel || 'info';
        document.getElementById('tbCaPath').value = cfg.tb.caPath || '';
        document.getElementById('tbCertPath').value = cfg.tb.certPath || '';
        document.getElementById('tbKeyPath').value = cfg.tb.keyPath || '';
        document.getElementById('writeMinIntervalMs').value = String(cfg.writeMinIntervalMs ?? 100);
        document.getElementById('mqttFlushBatchSize').value = String(cfg.mqttFlushBatchSize ?? 200);
        document.getElementById('mqttFlushDelayMs').value = String(cfg.mqttFlushDelayMs ?? 0);
        document.getElementById('mqttFlushIntervalMs').value = String(cfg.mqttFlushIntervalMs ?? 15000);
        document.getElementById('throttleFlushBatchSize').value = String(cfg.mqttFlushBatchSize ?? 200);
        document.getElementById('throttleFlushDelayMs').value = String(cfg.mqttFlushDelayMs ?? 0);
        document.getElementById('throttleFlushIntervalMs').value = String(cfg.mqttFlushIntervalMs ?? 15000);
        document.getElementById('tbRejectUnauthorized').checked = cfg.tb.rejectUnauthorized !== false;

        document.getElementById('opcUrl').value = cfg.opcua.url || '';
        document.getElementById('opcUsername').value = cfg.opcua.username || '';
        document.getElementById('opcPassword').value = cfg.opcua.password || '';
        document.getElementById('opcSamplingMs').value = String(cfg.opcua.samplingMs ?? 250);
        document.getElementById('opcSecurityPolicy').value = cfg.opcua.securityPolicy || 'None';
        document.getElementById('opcSecurityMode').value = cfg.opcua.securityMode || 'None';
        document.getElementById('opcCertificateFile').value = cfg.opcua.certificateFile || '';
        document.getElementById('opcPrivateKeyFile').value = cfg.opcua.privateKeyFile || '';
        document.getElementById('opcSubscribe').checked = cfg.opcua.subscribe !== false;
        renderMappingList();
      }

      function renderMappingList() {
        const mapping = (state.config && Array.isArray(state.config.mapping)) ? state.config.mapping : [];
        if (mapping.length === 0) {
          els.mappingList.innerHTML = '<div class="hint">No mapped tags yet.</div>';
          return;
        }

        els.mappingList.innerHTML = mapping.map((tag) => {
          const target = tag.target || { mode: 'gateway-device', telemetryKey: tag.key };
          const targetLabel = target.mode === 'mapped-device'
            ? 'Mapped device: ' + (target.thingsBoardDeviceName || target.thingsBoardDeviceId || 'unresolved')
            : 'Gateway device';
          return '<div class="mapping-item">' +
            '<strong>' + escapeHtml(tag.key) + '</strong>' +
            '<div class="hint" title="' + escapeHtml(tag.nodeId) + '">' + escapeHtml(tag.nodeId) + '</div>' +
            '<div class="tree-meta">' +
              '<span class="mini-pill">' + escapeHtml(tag.type) + '</span>' +
              '<span class="mini-pill">' + escapeHtml(target.mode || 'gateway-device') + '</span>' +
              '<span class="mini-pill">' + escapeHtml(target.telemetryKey || tag.key) + '</span>' +
              '<span class="mini-pill" title="' + escapeHtml(targetLabel) + '">' + escapeHtml(targetLabel) + '</span>' +
              '<span class="mini-pill">' + (tag.writable ? 'Writable' : 'Read only') + '</span>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      function renderStatus() {
        const status = state.status;
        if (!status) return;
        const overall = status.healthState || (status.ok ? 'Healthy' : 'Attention');
        els.overallStatus.textContent = overall;
        els.overallStatus.className = 'status-pill ' + (status.ok ? 'status-ok' : 'status-bad');

        els.mqttState.textContent = status.mqtt.connected ? 'Connected' : 'Offline';
        els.mqttMeta.textContent = 'fresh=' + status.mqtt.fresh + ', buffered=' + status.mqtt.buffered;
        els.opcState.textContent = status.opcua.connected ? 'Connected' : 'Offline';
        els.opcMeta.textContent =
          'fresh=' + status.opcua.fresh +
          ', sub=' + status.opcua.subscription +
          (status.opcua.lastError ? ', error=' + status.opcua.lastError : '');
        els.bufferedCount.textContent = String(status.mqtt.buffered ?? 0);
        els.rpcPending.textContent = String(status.rpc.pendingTotal ?? 0);
        els.statusDump.textContent = JSON.stringify(status, null, 2);
        renderVersion(status.version);
        renderBufferingStatus();
      }

      function renderBufferingStatus() {
        const status = state.status || {};
        const mqtt = status.mqtt || {};
        const diagnostics = mqtt.diagnostics || {};
        const batchSize = Number(diagnostics.flushBatchSize || state.config?.mqttFlushBatchSize || 200);
        const delayMs = Number(diagnostics.flushDelayMs ?? state.config?.mqttFlushDelayMs ?? 0);
        const intervalMs = Number(diagnostics.flushIntervalMs || state.config?.mqttFlushIntervalMs || 15000);
        const buffer = diagnostics.buffer || {};
        const replay = diagnostics.replay || {};
        const metrics = diagnostics.metrics || {};
        const approxRate = replay.configuredApproxMaxRatePerSec
          ? replay.configuredApproxMaxRatePerSec + '/sec'
          : (delayMs > 0 ? Math.round(batchSize * 1000 / delayMs) + '/sec' : 'unlimited');
        const oldestAge = buffer.oldestAgeMs == null ? '-' : Math.round(buffer.oldestAgeMs / 1000) + 's';

        els.bufferingBufferedCount.textContent = String(mqtt.buffered ?? diagnostics.buffered ?? 0);
        els.bufferingFlushState.textContent = diagnostics.flushing ? 'Flushing' : 'Idle';
        els.bufferingFlushMeta.textContent =
          'batch=' + batchSize +
          ', delay=' + delayMs + 'ms' +
          ', interval=' + intervalMs + 'ms' +
          ', oldest=' + oldestAge;
        els.bufferingReplayRate.textContent = approxRate;
        els.bufferingReplayRate.title =
          'last flush ' + (replay.lastFlushPublished ?? metrics.lastFlushPublished ?? 0) +
          ' messages at ' + (replay.lastFlushRatePerSec ?? metrics.lastFlushRatePerSec ?? 0) + '/sec';
      }

      function formatMemory(bytes) {
        const value = Number(bytes || 0);
        if (value > 1024 * 1024) return Math.round(value / 1024 / 1024) + ' MB';
        if (value > 1024) return Math.round(value / 1024) + ' KB';
        return value + ' B';
      }

      function debugTile(label, value, meta) {
        return '<div class="debug-tile">' +
          '<div class="debug-tile-label">' + escapeHtml(label) + '</div>' +
          '<div class="debug-tile-value">' + escapeHtml(value) + '</div>' +
          '<div class="debug-tile-meta" title="' + escapeHtml(meta || '') + '">' + escapeHtml(meta || '') + '</div>' +
        '</div>';
      }

      function renderLogMessage(entry) {
        const message = typeof entry.message === 'string'
          ? entry.message
          : JSON.stringify(entry.message);
        const metaKeys = entry.meta && Object.keys(entry.meta).length > 0
          ? ' ' + JSON.stringify(entry.meta)
          : '';
        const stack = entry.stack ? '\\n' + entry.stack : '';
        return message + metaKeys + stack;
      }

      function renderDebug() {
        const debug = state.debug;
        if (!debug) return;
        const status = debug.status || {};
        const processInfo = debug.process || {};
        const memory = processInfo.memory || {};
        const logsInfo = (debug.paths && debug.paths.logs) || {};
        const opcDiagnostics = (status.opcua && status.opcua.diagnostics) || {};

        els.debugSummary.innerHTML =
          debugTile('Runtime', status.runtimeState || '-', 'uptime ' + (processInfo.uptimeSec || 0) + 's, pid ' + (processInfo.pid || '-')) +
          debugTile('MQTT', status.mqtt && status.mqtt.connected ? 'Connected' : 'Offline', 'buffered ' + ((status.mqtt && status.mqtt.buffered) || 0)) +
          debugTile('OPC UA', status.opcua && status.opcua.connected ? 'Connected' : 'Offline', 'subscription ' + (opcDiagnostics.subscriptionState || status.opcua?.subscription || '-')) +
          debugTile('Health', status.healthState || '-', (status.alerts || []).join(', ')) +
          debugTile('Logs', String((debug.logs || []).length), logsInfo.logFile || '');

        const compactDebug = {
          ok: debug.ok,
          ts: debug.ts,
          process: {
            ...processInfo,
            memory: {
              rss: formatMemory(memory.rss),
              heapUsed: formatMemory(memory.heapUsed),
              heapTotal: formatMemory(memory.heapTotal)
            }
          },
          paths: debug.paths,
          status: debug.status,
          config: debug.config
        };
        els.debugDump.textContent = JSON.stringify(compactDebug, null, 2);

        const logs = debug.logs || [];
        if (logs.length === 0) {
          els.logList.innerHTML = '<div class="hint p-3">No matching logs in memory for this process.</div>';
          return;
        }
        els.logList.innerHTML = logs.map((entry) => {
          const level = String(entry.level || 'info');
          return '<div class="log-entry ' + escapeHtml(level) + '">' +
            '<div class="log-ts">' + escapeHtml(entry.ts || '') + '</div>' +
            '<div class="log-level">' + escapeHtml(level) + '</div>' +
            '<div class="log-message">' + escapeHtml(renderLogMessage(entry)) + '</div>' +
          '</div>';
        }).join('');
      }

      async function loadDebug() {
        if (!state.authenticated) return;
        const params = new URLSearchParams();
        params.set('level', els.debugLogLevel.value || 'all');
        params.set('limit', els.debugLogLimit.value || '200');
        const query = els.debugLogSearch.value.trim();
        if (query) params.set('q', query);
        state.debug = await api('/api/debug?' + params.toString());
        renderDebug();
        setMessage(els.debugMessage, '', '');
      }

      async function copyDebugPayload() {
        if (!state.authenticated) throw new AuthExpiredError();
        if (!state.debug) {
          await loadDebug();
        }
        await navigator.clipboard.writeText(JSON.stringify(state.debug, null, 2));
        setMessage(els.debugMessage, 'Debug JSON copied.', 'success');
      }

      function renderBackups() {
        const backups = (state.backups && state.backups.local) || [];
        if (!backups.length) {
          els.backupList.innerHTML = '<div class="hint">No local backups yet.</div>';
          return;
        }

        els.backupList.innerHTML = backups.map((backup) => {
          if (backup.invalid) {
            return '<div class="mapping-item">' +
              '<strong>' + escapeHtml(backup.fileName) + '</strong>' +
              '<div class="hint">Invalid backup JSON</div>' +
              '<div></div>' +
            '</div>';
          }
          const restoreDisabled = backup.redacted ? ' disabled title="Redacted backups remove secrets and cannot be restored"' : '';
          return '<div class="mapping-item">' +
            '<strong>' + escapeHtml(backup.fileName) + '</strong>' +
            '<div class="hint">' +
              escapeHtml(backup.deviceName || '-') +
              ' · ' + escapeHtml(backup.configVersion || '-') +
              ' · mappings ' + escapeHtml(backup.mappingCount ?? '-') +
              (backup.redacted ? ' · redacted export' : ' · full backup') +
              ' · ' + escapeHtml(backup.createdAt || backup.modifiedAt || '-') +
            '</div>' +
            '<div class="tree-meta">' +
              '<button class="btn btn-outline-primary btn-sm" type="button" data-restore-backup="' + escapeHtml(backup.fileName) + '"' + restoreDisabled + '>Restore</button>' +
            '</div>' +
          '</div>';
        }).join('');

        for (const button of els.backupList.querySelectorAll('[data-restore-backup]')) {
          button.addEventListener('click', async () => {
            const fileName = button.getAttribute('data-restore-backup');
            if (!window.confirm('Restore ' + fileName + '? A rollback backup will be created first.')) return;
            await restoreLocalBackup(fileName);
          });
        }
      }

      async function loadBackups() {
        if (!state.authenticated) return;
        state.backups = await api('/api/config/backups');
        renderBackups();
      }

      async function afterRestoreResult(result, messagePrefix) {
        if (result.config) {
          state.config = result.config;
          renderConfig();
        } else {
          await loadConfig();
        }
        await loadStatus();
        await loadBackups();
        if (result.runtimeApplyError) {
          setMessage(els.backupMessage, messagePrefix + ' saved, but runtime apply failed: ' + result.runtimeApplyError, 'error');
        } else {
          setMessage(els.backupMessage, messagePrefix + ' restored and applied.', 'success');
        }
      }

      async function createLocalBackup() {
        const result = await api('/api/config/backup/local', { method: 'POST', body: '{}' });
        await loadBackups();
        setMessage(els.backupMessage, 'Local backup created: ' + result.backup.fileName, 'success');
      }

      async function createRedactedLocalBackup() {
        const result = await api('/api/config/backup/local/redacted', { method: 'POST', body: '{}' });
        await loadBackups();
        setMessage(els.backupMessage, 'Redacted export created: ' + result.backup.fileName, 'success');
      }

      async function pushThingsBoardBackup() {
        const result = await api('/api/config/backup/thingsboard', { method: 'POST', body: '{}' });
        setMessage(els.backupMessage, 'ThingsBoard backup pushed: ' + (result.backup.configVersion || result.backup.hash), 'success');
      }

      async function restoreLocalBackup(fileName) {
        setMessage(els.backupMessage, '', '');
        const result = await api('/api/config/restore/local', {
          method: 'POST',
          body: JSON.stringify({ fileName })
        });
        await afterRestoreResult(result, 'Local backup');
      }

      async function restoreThingsBoardBackup() {
        if (!window.confirm('Restore config backup from ThingsBoard? A rollback backup will be created first.')) return;
        setMessage(els.backupMessage, '', '');
        const result = await api('/api/config/restore/thingsboard', { method: 'POST', body: '{}' });
        await afterRestoreResult(result, 'ThingsBoard backup');
      }

      async function restoreUploadedBackup() {
        const file = els.backupUploadFile.files && els.backupUploadFile.files[0];
        if (!file) {
          setMessage(els.backupMessage, 'Select a JSON backup file first.', 'error');
          return;
        }
        if (!window.confirm('Restore uploaded JSON? A rollback backup will be created first.')) return;
        const text = await file.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          setMessage(els.backupMessage, 'Uploaded file is not valid JSON.', 'error');
          return;
        }
        const result = await api('/api/config/restore/upload', {
          method: 'POST',
          body: JSON.stringify({ backup: parsed })
        });
        await afterRestoreResult(result, 'Uploaded backup');
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      async function loadBrowserNode(nodeId) {
        if (!state.authenticated) return;
        state.browserLoading.add(nodeId);
        renderBrowserTree();
        try {
          const result = await api('/api/opcua/browse?nodeId=' + encodeURIComponent(nodeId));
          state.browserChildren.set(nodeId, result.nodes || []);
          for (const node of result.nodes || []) {
            state.browserNodes.set(node.nodeId, node);
          }
          state.browserExpanded.add(nodeId);
          setMessage(els.browserMessage, '', '');
        } catch (error) {
          setMessage(els.browserMessage, error.message, 'error');
        } finally {
          state.browserLoading.delete(nodeId);
          renderBrowserTree();
        }
      }

      function renderBrowserTree() {
        const rootChildren = state.browserChildren.get('RootFolder') || [];
        if (state.browserLoading.has('RootFolder') && rootChildren.length === 0) {
          els.browserTree.innerHTML = '<div class="hint">Loading OPC UA tree…</div>';
          return;
        }
        if (rootChildren.length === 0) {
          els.browserTree.innerHTML = '<div class="hint">No browser data yet. Reload the tree when OPC UA is connected.</div>';
          return;
        }

        els.browserTree.innerHTML = rootChildren.map(renderNodeHtml).join('');
        bindBrowserActions();
      }

      function renderNodeHtml(node) {
        const expanded = state.browserExpanded.has(node.nodeId);
        const loading = state.browserLoading.has(node.nodeId);
        const children = state.browserChildren.get(node.nodeId) || [];
        const isVariable = node.nodeClass === 'Variable' || (!!node.dataType && !node.hasChildren);
        const chevron = node.hasChildren ? (expanded ? '−' : '+') : '·';

        return '<div class="tree-node">' +
          '<button class="tree-row ' + (isVariable ? 'is-variable' : '') + '" type="button" data-node-id="' + escapeHtml(node.nodeId) + '" data-node-class="' + escapeHtml(node.nodeClass) + '" data-node-variable="' + (isVariable ? 'true' : 'false') + '">' +
            '<span class="tree-chevron">' + chevron + '</span>' +
            '<span class="tree-label" title="' + escapeHtml(node.nodeId) + '">' + escapeHtml(node.displayName || node.browseName || node.nodeId) + '</span>' +
            '<span class="tree-meta">' +
              '<span class="mini-pill">' + escapeHtml(node.nodeClass) + '</span>' +
              (node.dataType ? '<span class="mini-pill">' + escapeHtml(node.dataType) + '</span>' : '') +
              (node.writable ? '<span class="mini-pill">Writable</span>' : '') +
              (loading ? '<span class="mini-pill">Loading</span>' : '') +
            '</span>' +
          '</button>' +
          (expanded && children.length > 0
            ? '<div class="tree-children">' + children.map(renderNodeHtml).join('') + '</div>'
            : '') +
        '</div>';
      }

      function bindBrowserActions() {
        for (const button of els.browserTree.querySelectorAll('[data-node-id]')) {
          button.addEventListener('click', async () => {
            try {
              const nodeId = button.getAttribute('data-node-id');
              const node = state.browserNodes.get(nodeId) || {
                nodeId,
                nodeClass: button.getAttribute('data-node-class'),
                hasChildren: false
              };
              const isVariable =
                button.getAttribute('data-node-variable') === 'true' ||
                node.nodeClass === 'Variable' ||
                (!!node.dataType && !node.hasChildren);

              if (isVariable) {
                openAddTagModal(node);
                return;
              }
              if (!node.hasChildren) return;
              if (state.browserExpanded.has(nodeId)) {
                state.browserExpanded.delete(nodeId);
                renderBrowserTree();
                return;
              }
              if (!state.browserChildren.has(nodeId)) {
                await loadBrowserNode(nodeId);
                return;
              }
              state.browserExpanded.add(nodeId);
              renderBrowserTree();
            } catch (error) {
              setMessage(els.browserMessage, error.message || String(error), 'error');
            }
          });
        }
      }

      function openAddTagModal(node) {
        state.selectedBrowserNode = node;
        const defaultKey = (node.browseName || node.displayName || 'Tag').replace(/[^a-zA-Z0-9]+/g, '_');
        els.addTagKey.value = defaultKey;
        els.addTagTelemetryKey.value = defaultKey;
        els.addTagTargetMode.value = 'gateway-device';
        els.addTagTargetDeviceName.value = '';
        els.addTagTargetDeviceId.value = '';
        els.addTagType.value = node.dataType || 'String';
        els.addTagWritable.checked = !!node.writable;
        els.selectedNodeInfo.textContent =
          (node.displayName || node.browseName || 'Node') + ' • ' + node.nodeId;
        setMessage(els.addTagMessage, '', '');
        showAddTagModal();
        syncTargetModeFields();
      }

      async function loadConfig() {
        if (!state.authenticated) return;
        state.config = await api('/api/config');
        renderConfig();
      }

      async function loadStatus() {
        if (!state.authenticated) return;
        state.status = await api('/api/status');
        renderStatus();
      }

      async function initAuthenticatedView() {
        state.authenticated = true;
        await loadConfig();
        await loadStatus();
        showApp();
        if (!state.browserChildren.has('RootFolder')) {
          await loadBrowserNode('RootFolder');
        }
      }

      els.loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.loginMessage, '', '');
        try {
          await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({
              username: els.loginUsername.value,
              password: els.loginPassword.value
            })
          });
          state.authExpired = false;
          els.loginPassword.value = '';
          await initAuthenticatedView();
        } catch (error) {
          setMessage(els.loginMessage, error.message, 'error');
        }
      });

      els.logoutBtn.addEventListener('click', async () => {
        await api('/api/logout', { method: 'POST', body: '{}' });
        state.authenticated = false;
        state.authExpired = false;
        state.config = null;
        state.status = null;
        state.debug = null;
        state.backups = null;
        showLogin();
      });

      els.refreshStatusBtn.addEventListener('click', async () => {
        try {
          await loadStatus();
        } catch (error) {
          if (!(error instanceof AuthExpiredError)) setMessage(els.loginMessage, error.message, 'error');
        }
      });

      els.refreshBrowserBtn.addEventListener('click', async () => {
        if (!state.authenticated) {
          expireSession();
          return;
        }
        state.browserChildren.clear();
        state.browserExpanded.clear();
        state.browserNodes.clear();
        await loadBrowserNode('RootFolder');
      });

      els.refreshDebugBtn.addEventListener('click', async () => {
        try {
          await loadDebug();
        } catch (error) {
          setMessage(els.debugMessage, error.message, 'error');
        }
      });

      els.copyDebugBtn.addEventListener('click', async () => {
        try {
          await copyDebugPayload();
        } catch (error) {
          setMessage(els.debugMessage, error.message, 'error');
        }
      });

      els.throttleConservativePreset.addEventListener('click', () => {
        document.getElementById('throttleFlushBatchSize').value = '50';
        document.getElementById('throttleFlushDelayMs').value = '250';
        document.getElementById('throttleFlushIntervalMs').value = '15000';
        setMessage(els.throttleMessage, 'IoTDB safe preset loaded. Save to apply.', '');
      });

      els.throttleDefaultPreset.addEventListener('click', () => {
        document.getElementById('throttleFlushBatchSize').value = '200';
        document.getElementById('throttleFlushDelayMs').value = '0';
        document.getElementById('throttleFlushIntervalMs').value = '15000';
        setMessage(els.throttleMessage, 'Default preset loaded. Save to apply.', '');
      });

      els.refreshBackupsBtn.addEventListener('click', async () => {
        try {
          await loadBackups();
          setMessage(els.backupMessage, '', '');
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.createLocalBackupBtn.addEventListener('click', async () => {
        try {
          await createLocalBackup();
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.createRedactedLocalBackupBtn.addEventListener('click', async () => {
        try {
          await createRedactedLocalBackup();
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.pushTbBackupBtn.addEventListener('click', async () => {
        try {
          await pushThingsBoardBackup();
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.restoreTbBackupBtn.addEventListener('click', async () => {
        try {
          await restoreThingsBoardBackup();
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.restoreUploadBackupBtn.addEventListener('click', async () => {
        try {
          await restoreUploadedBackup();
        } catch (error) {
          setMessage(els.backupMessage, error.message, 'error');
        }
      });

      els.debugLogLevel.addEventListener('change', () => loadDebug().catch((error) => setMessage(els.debugMessage, error.message, 'error')));
      els.debugLogLimit.addEventListener('change', () => loadDebug().catch((error) => setMessage(els.debugMessage, error.message, 'error')));
      els.debugLogSearch.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadDebug().catch((error) => setMessage(els.debugMessage, error.message, 'error'));
        }
      });

      els.closeAddTagModal.addEventListener('click', hideAddTagModal);
      els.cancelAddTagModal.addEventListener('click', hideAddTagModal);
      els.addTagTargetMode.addEventListener('change', syncTargetModeFields);
      els.addTagModal.addEventListener('click', (event) => {
        if (event.target === els.addTagModal) {
          hideAddTagModal();
        }
      });

      els.addTagForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.addTagMessage, '', '');
        const node = state.selectedBrowserNode;
        if (!node) {
          setMessage(els.addTagMessage, 'No OPC UA node selected.', 'error');
          return;
        }

        const key = els.addTagKey.value.trim();
        const type = els.addTagType.value;
        const writable = els.addTagWritable.checked;
        const targetMode = els.addTagTargetMode.value;
        const targetDeviceName = els.addTagTargetDeviceName.value.trim();
        const targetDeviceId = els.addTagTargetDeviceId.value.trim();
        const telemetryKey = els.addTagTelemetryKey.value.trim() || key;

        if (targetMode === 'mapped-device' && !targetDeviceName && !targetDeviceId) {
          setMessage(els.addTagMessage, 'Mapped-device mode requires a target device name or ID.', 'error');
          return;
        }

        try {
          state.config = await api('/api/opcua/mapping', {
            method: 'POST',
            body: JSON.stringify({
              key,
              nodeId: node.nodeId,
              type,
              writable,
              target: {
                mode: targetMode,
                thingsBoardDeviceName: targetDeviceName || undefined,
                thingsBoardDeviceId: targetDeviceId || undefined,
                telemetryKey
              },
              browseName: node.browseName,
              displayName: node.displayName
            })
          });
          renderConfig();
          await loadStatus();
          hideAddTagModal();
          setMessage(els.browserMessage, 'Added ' + key + ' to config mapping.', 'success');
        } catch (error) {
          if (!(error instanceof AuthExpiredError)) setMessage(els.addTagMessage, error.message, 'error');
        }
      });

      for (const button of tabButtons) {
        button.addEventListener('click', () => activateTab(button.dataset.tab));
      }

      els.tbForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.tbMessage, '', '');
        try {
          if (!state.authenticated) throw new AuthExpiredError();
          const patch = {
            deviceName: document.getElementById('deviceName').value.trim(),
            logLevel: document.getElementById('logLevel').value,
            writeMinIntervalMs: Number(document.getElementById('writeMinIntervalMs').value),
            mqttFlushBatchSize: Number(document.getElementById('mqttFlushBatchSize').value),
            mqttFlushDelayMs: Number(document.getElementById('mqttFlushDelayMs').value),
            mqttFlushIntervalMs: Number(document.getElementById('mqttFlushIntervalMs').value),
            tb: {
              url: document.getElementById('tbUrl').value.trim(),
              accessToken: document.getElementById('tbAccessToken').value,
              clientId: document.getElementById('tbClientId').value.trim(),
              qos: Number(document.getElementById('tbQos').value),
              caPath: document.getElementById('tbCaPath').value.trim(),
              certPath: document.getElementById('tbCertPath').value.trim(),
              keyPath: document.getElementById('tbKeyPath').value.trim(),
              rejectUnauthorized: document.getElementById('tbRejectUnauthorized').checked
            }
          };

          state.config = await api('/api/config', {
            method: 'PUT',
            body: JSON.stringify(patch)
          });
          renderConfig();
          await loadStatus();
          if (state.config.runtimeApplyError) {
            setMessage(els.tbMessage, 'Settings saved, but runtime apply failed: ' + state.config.runtimeApplyError, 'error');
          } else {
            setMessage(els.tbMessage, 'MQTT / ThingsBoard settings saved and applied.', 'success');
          }
        } catch (error) {
          if (!(error instanceof AuthExpiredError)) setMessage(els.tbMessage, error.message, 'error');
        }
      });

      els.opcForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.opcMessage, '', '');
        try {
          if (!state.authenticated) throw new AuthExpiredError();
          const patch = {
            opcua: {
              url: document.getElementById('opcUrl').value.trim(),
              username: document.getElementById('opcUsername').value.trim(),
              password: document.getElementById('opcPassword').value,
              samplingMs: Number(document.getElementById('opcSamplingMs').value),
              securityPolicy: document.getElementById('opcSecurityPolicy').value,
              securityMode: document.getElementById('opcSecurityMode').value,
              certificateFile: document.getElementById('opcCertificateFile').value.trim(),
              privateKeyFile: document.getElementById('opcPrivateKeyFile').value.trim(),
              subscribe: document.getElementById('opcSubscribe').checked
            }
          };

          state.config = await api('/api/config', {
            method: 'PUT',
            body: JSON.stringify(patch)
          });
          renderConfig();
          await loadStatus();
          if (state.config.runtimeApplyError) {
            setMessage(els.opcMessage, 'Settings saved, but runtime apply failed: ' + state.config.runtimeApplyError, 'error');
          } else {
            setMessage(els.opcMessage, 'OPC UA settings saved and applied.', 'success');
          }
        } catch (error) {
          if (!(error instanceof AuthExpiredError)) setMessage(els.opcMessage, error.message, 'error');
        }
      });

      els.throttleForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.throttleMessage, '', '');
        try {
          if (!state.authenticated) throw new AuthExpiredError();
          const patch = {
            mqttFlushBatchSize: Number(document.getElementById('throttleFlushBatchSize').value),
            mqttFlushDelayMs: Number(document.getElementById('throttleFlushDelayMs').value),
            mqttFlushIntervalMs: Number(document.getElementById('throttleFlushIntervalMs').value)
          };

          state.config = await api('/api/config', {
            method: 'PUT',
            body: JSON.stringify(patch)
          });
          renderConfig();
          await loadStatus();
          if (state.config.runtimeApplyError) {
            setMessage(els.throttleMessage, 'Settings saved, but runtime apply failed: ' + state.config.runtimeApplyError, 'error');
          } else {
            setMessage(els.throttleMessage, 'Replay throttle saved and applied.', 'success');
          }
        } catch (error) {
          if (!(error instanceof AuthExpiredError)) setMessage(els.throttleMessage, error.message, 'error');
        }
      });

      els.passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(els.passwordMessage, '', '');
        try {
          await api('/api/admin/password', {
            method: 'POST',
            body: JSON.stringify({
              currentPassword: document.getElementById('currentPassword').value,
              newPassword: document.getElementById('newPassword').value,
              confirmPassword: document.getElementById('confirmPassword').value
            })
          });
          els.passwordForm.reset();
          setMessage(els.passwordMessage, 'Admin password changed.', 'success');
        } catch (error) {
          setMessage(els.passwordMessage, error.message, 'error');
        }
      });

      async function bootstrap() {
        activateTab('status');
        bindNavTree();
        const url = new URL(window.location.href);
        if (url.searchParams.has('username') || url.searchParams.has('password')) {
          url.searchParams.delete('username');
          url.searchParams.delete('password');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          setMessage(
            els.loginMessage,
            'Credentials in the URL were removed. Sign in through the form instead.',
            'error'
          );
        }
        try {
          const session = await api('/api/session');
          renderVersion(session.version);
          if (session.authenticated) {
            state.authExpired = false;
            await initAuthenticatedView();
          } else {
            state.authenticated = false;
            showLogin();
          }
        } catch {
          showLogin();
        }
      }

      bootstrap();
    </script>
  </body>
</html>`;
}
