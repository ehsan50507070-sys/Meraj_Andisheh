import {
  ArrowRight,
  Award,
  Gamepad2,
  LogIn,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameLeaderboardEntry,
  PublicGameDetailData,
} from '../../core/domain/games';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import type { ResourceKey } from '../resources/fa';
import {
  formatJalaliDateTimePersian,
  toPersianDigits,
} from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface GamePlayPageProps {
  currentRoute: string;
  slug: string;
}

export function GamePlayPage({ currentRoute, slug }: GamePlayPageProps) {
  const { currentUser, siteTitle, isGamesEnabled, isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  const [detail, setDetail] = useState<PublicGameDetailData | null>(null);
  const [leaderboard, setLeaderboard] = useState<GameLeaderboardEntry[]>([]);
  const [userBestScore, setUserBestScore] = useState<number | null>(null);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [frameKey, setFrameKey] = useState(0);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  const [completedRunScore, setCompletedRunScore] = useState<number | null>(null);
  const [showEndBanner, setShowEndBanner] = useState(false);
  const [scoreFeedback, setScoreFeedback] = useState<{
    variant: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  usePageMeta({
    currentRoute,
    siteTitle,
    pageTitle: detail?.game.title ?? null,
    description: detail?.game.description ?? null,
  });

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    if (!isGamesEnabled) {
      setIsNotFound(true);
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadGameDetail = async () => {
      setIsLoading(true);
      setIsNotFound(false);
      setDetail(null);
      setCompletedRunScore(null);
      setShowEndBanner(false);
      setScoreFeedback(null);

      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.gamePortalService.getPublicGameDetailAsync(
          slug,
          effectiveAgeGroup,
          currentUser,
        );
        if (!active) return;

        if (res.status === 'not_found') {
          setIsNotFound(true);
          setDetail(null);
          return;
        }

        setIsNotFound(false);
        setDetail(res.data);
        setLeaderboard(res.data.leaderboard);
        setUserBestScore(res.data.currentUserBestScore);
        setUserRank(res.data.currentUserRank);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadGameDetail();
    return () => {
      active = false;
    };
  }, [slug, effectiveAgeGroup, isAgeReady, isAuthReady, isGamesEnabled, currentUser]);

  const handleScoreMessage = useCallback(
    async (rawScore: unknown) => {
      if (!detail) return;
      const numericScore =
        typeof rawScore === 'number' ? rawScore : Number(rawScore);

      setCompletedRunScore(
        Number.isFinite(numericScore) ? numericScore : null,
      );
      setShowEndBanner(true);

      if (!currentUser || !currentUser.isActive) {
        setScoreFeedback({
          variant: 'info',
          message: t('games.play.guestScoreNotice'),
        });
        return;
      }

      const submitRes = await appContainer.gamePortalService.submitGameScoreAsync(
        currentUser,
        {
          gameId: detail.game.id,
          score: numericScore,
          activeAgeGroup: effectiveAgeGroup,
        },
      );

      if (!submitRes.ok || !submitRes.data) {
        setScoreFeedback({
          variant: 'error',
          message: submitRes.messageKey
            ? t(submitRes.messageKey as ResourceKey)
            : t('games.score.error.invalidScore'),
        });
        return;
      }

      setLeaderboard(submitRes.data.leaderboard);
      setUserBestScore(submitRes.data.currentUserBestScore);
      setUserRank(submitRes.data.currentUserRank);
      setScoreFeedback({
        variant: 'success',
        message: t('games.play.scoreSavedSuccess', {
          score: toPersianDigits(submitRes.data.recordedScore.score),
          best: toPersianDigits(submitRes.data.currentUserBestScore),
        }),
      });
    },
    [currentUser, detail, effectiveAgeGroup],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const payload = event.data as
        | { type?: unknown; score?: unknown }
        | null
        | undefined;
      if (!payload || payload.type !== 'MERAJ_GAME_SCORE') {
        return;
      }
      void handleScoreMessage(payload.score);
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [handleScoreMessage]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const handleRestartGame = () => {
    setCompletedRunScore(null);
    setShowEndBanner(false);
    setScoreFeedback(null);
    setFrameKey((prev) => prev + 1);
  };

  const handleToggleFullscreen = async () => {
    if (isNativeFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        setIsPseudoFullscreen(false);
      }
      return;
    }

    if (stageContainerRef.current?.requestFullscreen) {
      try {
        await stageContainerRef.current.requestFullscreen();
        return;
      } catch {
        // Fallback inside restricted containers
      }
    }
    setIsPseudoFullscreen((prev) => !prev);
  };

  if (!isAgeReady || !isAuthReady || isLoading) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('games.play.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isGamesEnabled || isNotFound || !detail) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const returnToGameHash = `#/games/${encodeURIComponent(detail.game.slug)}`;
  const isFullscreenActive = isNativeFullscreen || isPseudoFullscreen;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Back button + Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToHash('/games')}
            startIcon={<ArrowRight className="w-4 h-4" />}
          >
            {t('games.play.backToPortal')}
          </Button>

          <header className="pb-5 border-b border-[var(--color-border)] space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm text-[var(--color-muted)] tabular-nums-strict">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-primary)]">
                <Gamepad2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{detail.topic?.name ?? t('catalog.generalTopic')}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t('games.play.maxScoreInfo', {
                  score: toPersianDigits(detail.game.maxScore),
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {detail.targetAgeGroups.length > 0
                  ? detail.targetAgeGroups
                      .map((ag) => ag.name)
                      .join(t('homePreview.targetListSeparator'))
                  : t('games.portal.allAgesBadge')}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
              {detail.game.title}
            </h1>

            {detail.game.description && (
              <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed max-w-3xl">
                {detail.game.description}
              </p>
            )}
          </header>
        </div>

        {/* Sandbox Security Notice */}
        <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3 text-xs sm:text-sm text-[var(--color-muted)]">
          <ShieldCheck
            className="w-4 h-4 text-[var(--color-success-text)] shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>{t('games.play.sandboxNotice')}</span>
        </div>

        {/* Sandboxed Game Container */}
        <section
          ref={stageContainerRef}
          className={`bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col ${
            isFullscreenActive
              ? 'fixed inset-0 z-50 rounded-none border-0'
              : ''
          }`}
        >
          {/* Runner Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm tabular-nums-strict">
              <span className="font-semibold text-[var(--color-text)]">
                {detail.game.title}
              </span>
              {userBestScore !== null && (
                <span className="inline-flex items-center gap-1 text-[var(--color-primary)] font-semibold">
                  <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {t('games.play.yourBestScoreBadge', {
                      score: toPersianDigits(userBestScore),
                    })}
                  </span>
                  {userRank !== null && (
                    <span className="text-[var(--color-muted)]">
                      ({t('games.play.yourRankBadge', {
                        rank: toPersianDigits(userRank),
                      })})
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestartGame}
                startIcon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                {t('games.play.restartAction')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleToggleFullscreen()}
                startIcon={
                  isFullscreenActive ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )
                }
              >
                {isFullscreenActive
                  ? t('games.play.exitFullscreenAction')
                  : t('games.play.fullscreenAction')}
              </Button>
            </div>
          </div>

          {/* Isolated Sandbox Iframe */}
          <div
            className={`w-full bg-[#0F172A] ${
              isFullscreenActive ? 'flex-1 min-h-0' : 'h-[480px] sm:h-[560px]'
            }`}
          >
            <iframe
              key={`${detail.game.id}:${frameKey}`}
              ref={iframeRef}
              sandbox="allow-scripts"
              srcDoc={detail.srcdoc}
              title={t('games.play.iframeTitle', { title: detail.game.title })}
              className="w-full h-full border-0 block"
            />
          </div>
        </section>

        {/* Educational End-of-Game Message + Score Feedback */}
        {(showEndBanner || scoreFeedback) && (
          <section
            aria-live="polite"
            className="bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] p-5 sm:p-6 space-y-4 shadow-[var(--shadow-card)]"
          >
            {showEndBanner && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--color-primary)]">
                    <Sparkles className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span>{t('games.play.endBannerTitle')}</span>
                  </div>
                  {completedRunScore !== null && (
                    <span className="text-xs sm:text-sm font-bold text-[var(--color-text)] tabular-nums-strict">
                      {t('games.play.endScoreLine', {
                        score: toPersianDigits(completedRunScore),
                        max: toPersianDigits(detail.game.maxScore),
                      })}
                    </span>
                  )}
                </div>

                {detail.game.endMessage && (
                  <p className="text-sm sm:text-base text-[var(--color-text)] leading-relaxed bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--radius-control)] p-4">
                    {detail.game.endMessage}
                  </p>
                )}
              </div>
            )}

            {scoreFeedback && (
              <Alert
                variant={scoreFeedback.variant}
                message={scoreFeedback.message}
              />
            )}

            {(!currentUser || !currentUser.isActive) && (
              <div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    navigateToHash(
                      `/account/login?returnUrl=${encodeURIComponent(returnToGameHash)}`,
                    )
                  }
                  startIcon={<LogIn className="w-4 h-4" />}
                >
                  {t('games.play.guestLoginAction')}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Top-10 Leaderboard */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Trophy
                  className="w-5 h-5 text-[var(--color-accent)] shrink-0"
                  aria-hidden="true"
                />
                <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                  {t('games.leaderboard.title')}
                </h2>
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                {t('games.leaderboard.subtitle')}
              </p>
            </div>
          </div>

          {leaderboard.length === 0 ? (
            <div className="py-6 text-center space-y-1.5">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {t('games.leaderboard.emptyTitle')}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {t('games.leaderboard.emptyBody')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                    <th className="py-2.5 px-3 font-semibold">
                      {t('games.leaderboard.col.rank')}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {t('games.leaderboard.col.player')}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {t('games.leaderboard.col.score')}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {t('games.leaderboard.col.achievedAt')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] tabular-nums-strict">
                  {leaderboard.map((row) => (
                    <tr
                      key={row.userId}
                      className={
                        row.isCurrentUser
                          ? 'bg-[var(--color-surface-alt)] font-semibold'
                          : ''
                      }
                    >
                      <td className="py-3 px-3 font-bold text-[var(--color-primary)]">
                        {toPersianDigits(row.rank)}
                      </td>
                      <td className="py-3 px-3 text-[var(--color-text)]">
                        <span>{row.displayName}</span>
                        {row.isCurrentUser && (
                          <span className="mr-2 text-xs text-[var(--color-primary)]">
                            ({t('games.leaderboard.youBadge')})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-bold text-[var(--color-text)]">
                        {toPersianDigits(row.score)}
                      </td>
                      <td className="py-3 px-3 text-[var(--color-muted)]">
                        {formatJalaliDateTimePersian(row.achievedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Related Games */}
        {detail.relatedGames.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-[var(--color-text)]">
              {t('games.play.relatedHeading')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {detail.relatedGames.map((rel) => (
                <button
                  key={rel.game.id}
                  type="button"
                  onClick={() =>
                    navigateToHash(`/games/${encodeURIComponent(rel.game.slug)}`)
                  }
                  className="text-right bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-[var(--radius-card)] p-4 space-y-2 transition-colors"
                >
                  <div className="text-xs font-semibold text-[var(--color-primary)]">
                    {rel.topicName ?? t('catalog.generalTopic')}
                  </div>
                  <div className="text-sm font-bold text-[var(--color-text)] line-clamp-2">
                    {rel.game.title}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </MainLayout>
  );
}
