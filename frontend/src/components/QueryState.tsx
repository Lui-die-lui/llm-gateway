import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';

/** Inline loading / error line for a card whose query has not produced data. */
export function QueryState({ isLoading, error, onRetry }: { isLoading?: boolean; error?: unknown; onRetry?: () => void }) {
  if (error) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    return (
      <div className="err-box" role="alert">
        {errorMessage(error)}
        {unauthorized ? (
          <>
            {' '}
            · <Link to="/console/token">토큰 입력</Link>
          </>
        ) : (
          onRetry && (
            <>
              {' '}
              ·{' '}
              <button type="button" className="link-btn" onClick={onRetry}>
                다시 시도
              </button>
            </>
          )
        )}
      </div>
    );
  }
  if (isLoading) return <div className="empty">불러오는 중…</div>;
  return null;
}
