import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AgeGroup } from '../../core/domain/taxonomy';
import {
  resolveEffectiveAgeGroup,
  selectAgeGroupAsync,
  shouldShowAgeGate,
  type SelectAgeGroupResult,
} from '../../core/services/ageContextService';
import { resolveThemeKey } from '../../core/services/themeService';
import { useAuth } from '../auth/AuthContext';
import { appContainer } from '../services/appContainer';
import { ThemeManager } from '../theme/ThemeManager';

export type AgeSource = 'profile' | 'cookie' | 'none';

export interface AgeContextValue {
  activeAgeGroups: AgeGroup[];
  effectiveAgeGroup: AgeGroup | null;
  ageSource: AgeSource;
  isAgeReady: boolean;
  isAgeModalOpen: boolean;
  isFirstVisitGate: boolean;
  lastSwitchNotice: string | null;
  clearLastSwitchNotice: () => void;
  openAgeSelector: () => void;
  closeAgeSelector: () => void;
  selectAgeGroup: (ageGroupId: number) => Promise<SelectAgeGroupResult>;
  clearVisitorAgeCookie: () => void;
  refreshAgeGroups: () => Promise<void>;
}

const AgeContext = createContext<AgeContextValue | null>(null);

function getCurrentHashRaw(): string {
  if (typeof window === 'undefined') {
    return '#/';
  }
  return window.location.hash || '#/';
}

function getNormalizedPath(rawHash: string): string {
  const withoutHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const qIdx = withoutHash.indexOf('?');
  const pathOnly = qIdx === -1 ? withoutHash : withoutHash.slice(0, qIdx);
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const clean = withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
  return (clean || '/').toLowerCase();
}

export function AgeProvider({ children }: { children: ReactNode }) {
  const { currentUser, isAuthReady, refreshAuthState } = useAuth();
  const [activeAgeGroups, setActiveAgeGroups] = useState<AgeGroup[]>([]);
  const [isAgeReady, setIsAgeReady] = useState<boolean>(false);
  const [isManualSelectorOpen, setIsManualSelectorOpen] = useState<boolean>(false);
  const [preferenceVersion, setPreferenceVersion] = useState<number>(0);
  const [lastSwitchNotice, setLastSwitchNotice] = useState<string | null>(null);
  const [currentHashRaw, setCurrentHashRaw] = useState<string>(() => getCurrentHashRaw());

  const refreshAgeGroups = useCallback(async () => {
    await appContainer.ensureInitializedAtStartup();
    const groups = await appContainer.authRepository.getActiveAgeGroups();
    setActiveAgeGroups(groups);
    setIsAgeReady(true);
  }, []);

  useEffect(() => {
    void refreshAgeGroups();
  }, [refreshAgeGroups, currentUser?.id]);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHashRaw(getCurrentHashRaw());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const effectiveAgeGroup = useMemo(() => {
    void preferenceVersion;
    if (!isAgeReady) {
      return null;
    }
    return resolveEffectiveAgeGroup(currentUser, activeAgeGroups, appContainer.agePreferenceStorage);
  }, [currentUser, activeAgeGroups, isAgeReady, preferenceVersion]);

  const ageSource: AgeSource = useMemo(() => {
    if (!effectiveAgeGroup) {
      return 'none';
    }
    if (
      currentUser &&
      currentUser.ageGroupId !== null &&
      effectiveAgeGroup.id === currentUser.ageGroupId
    ) {
      return 'profile';
    }
    return 'cookie';
  }, [currentUser, effectiveAgeGroup]);

  const currentPath = useMemo(() => getNormalizedPath(currentHashRaw), [currentHashRaw]);

  // Synchronize effective age theme immediately on resolution / login / logout / route change
  // while preserving ?theme= override exclusively on #/dev/components
  useEffect(() => {
    if (!isAgeReady || !isAuthReady || !effectiveAgeGroup) {
      return;
    }

    const isDevComponentsWithQuery =
      currentPath === '/dev/components' && ThemeManager.readThemeFromHashQuery() !== null;
    if (isDevComponentsWithQuery) {
      return;
    }

    const targetTheme = resolveThemeKey(effectiveAgeGroup.themeKey);
    if (ThemeManager.getTheme() !== targetTheme) {
      ThemeManager.setTheme(targetTheme, false);
    }
  }, [isAgeReady, isAuthReady, effectiveAgeGroup, currentPath]);

  const isFirstVisitGate = useMemo(() => {
    if (!isAuthReady || !isAgeReady) {
      return false;
    }
    return shouldShowAgeGate(effectiveAgeGroup, currentHashRaw);
  }, [isAuthReady, isAgeReady, effectiveAgeGroup, currentHashRaw]);

  const isAgeModalOpen = isFirstVisitGate || isManualSelectorOpen;

  const openAgeSelector = useCallback(() => {
    void refreshAgeGroups();
    setIsManualSelectorOpen(true);
  }, [refreshAgeGroups]);

  const closeAgeSelector = useCallback(() => {
    if (isFirstVisitGate) {
      return;
    }
    setIsManualSelectorOpen(false);
  }, [isFirstVisitGate]);

  const selectAgeGroup = useCallback(
    async (ageGroupId: number): Promise<SelectAgeGroupResult> => {
      const latestGroups =
        activeAgeGroups.length > 0
          ? activeAgeGroups
          : await appContainer.authRepository.getActiveAgeGroups();

      const result = await selectAgeGroupAsync({
        ageGroupId,
        currentUser,
        activeAgeGroups: latestGroups,
        storage: appContainer.agePreferenceStorage,
        updateUserAgeGroup: async (uid, gid) => {
          await appContainer.authService.updateUserAgeGroup(uid, gid);
          await refreshAuthState();
        },
      });

      if (result.ok && result.ageGroup && result.themeKey) {
        const isDevComponentsWithQuery =
          currentPath === '/dev/components' && ThemeManager.readThemeFromHashQuery() !== null;
        if (!isDevComponentsWithQuery) {
          ThemeManager.setTheme(result.themeKey, false);
        }

        setPreferenceVersion((v) => v + 1);
        setIsManualSelectorOpen(false);
        setLastSwitchNotice(result.ageGroup.key);

        appContainer.logger.info('AGE_GROUP_SELECTED', {
          ageGroupId: result.ageGroup.id,
          ageGroupKey: result.ageGroup.key,
          themeKey: result.themeKey,
          source: currentUser ? 'profile_and_cookie' : 'cookie',
        });
      }

      return result;
    },
    [activeAgeGroups, currentUser, currentPath, refreshAuthState],
  );

  const clearVisitorAgeCookie = useCallback(() => {
    appContainer.agePreferenceStorage.clearAgeKey();
    setPreferenceVersion((v) => v + 1);
  }, []);

  const clearLastSwitchNotice = useCallback(() => {
    setLastSwitchNotice(null);
  }, []);

  return (
    <AgeContext.Provider
      value={{
        activeAgeGroups,
        effectiveAgeGroup,
        ageSource,
        isAgeReady,
        isAgeModalOpen,
        isFirstVisitGate,
        lastSwitchNotice,
        clearLastSwitchNotice,
        openAgeSelector,
        closeAgeSelector,
        selectAgeGroup,
        clearVisitorAgeCookie,
        refreshAgeGroups,
      }}
    >
      {children}
    </AgeContext.Provider>
  );
}

export function useAge(): AgeContextValue {
  const ctx = useContext(AgeContext);
  if (!ctx) {
    throw new Error('useAge must be used inside AgeProvider');
  }
  return ctx;
}
