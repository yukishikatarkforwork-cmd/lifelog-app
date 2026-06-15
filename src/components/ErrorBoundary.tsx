import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * 予期しない描画エラーや、コード分割したチャンクの取得失敗（ネットワーク断・デプロイ更新後の
 * 旧チャンク参照など）で画面が真っ白になるのを防ぐ。再読み込み導線を提示する。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 解析サービス導入時はここで送信する
    console.error('[lifelog] uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="logo">
          <div className="mark">😵</div>
          <h1>エラーが発生しました</h1>
          <p>画面の読み込み中に問題が起きました。</p>
        </div>
        <div className="card">
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 0 }}>
            ネットワーク状況をご確認のうえ、再読み込みしてください。
            繰り返す場合は時間をおいて再度お試しください。
          </p>
          {this.state.message && (
            <pre style={{ background: 'var(--fill)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', color: 'var(--muted)' }}>
              {this.state.message}
            </pre>
          )}
          <button className="btn full" onClick={this.handleReload}>再読み込み</button>
        </div>
      </div>
    );
  }
}
