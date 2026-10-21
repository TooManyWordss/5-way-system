import { Component, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { document.documentElement.classList.remove('session-checking'); console.error('Application screen failed:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="login"><section className="login-card" role="alert"><h1>This screen could not load</h1><p>Your saved records are unchanged. Reload to try again.</p><button className="btn primary" onClick={() => location.reload()}>Reload screen</button><a className="btn" href={location.pathname.startsWith('/rairock') ? '/rairock/' : '/'}>Choose another screen</a></section></main>;
  }
}
