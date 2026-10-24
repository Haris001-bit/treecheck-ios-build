import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roleLoading: boolean;
  isAdmin: boolean;
  isContractor: boolean;
  isFounder: boolean;
  parentContractorId: string | null;
  effectiveContractorId: string | null;
  isTeamMember: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

interface SessionBackup {
  access_token: string;
  refresh_token: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const EXPLICIT_SIGN_OUT_KEY = 'treecheck_explicit_signout';
const SESSION_BACKUP_KEY = 'treecheck_session_backup';

const getStorageItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStorageItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (iOS private mode/quota)
  }
};

const removeStorageItem = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage removal failures
  }
};

const readSessionBackup = (): SessionBackup | null => {
  const raw = getStorageItem(SESSION_BACKUP_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionBackup;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isContractor, setIsContractor] = useState(false);
  const [isFounder, setIsFounder] = useState(false);
  const [parentContractorId, setParentContractorId] = useState<string | null>(null);
  const recoveryPromiseRef = useRef<Promise<Session | null> | null>(null);
  const userIdRef = useRef<string | null>(null);
  const roleLookupUserRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  const resetRole = () => {
    roleLookupUserRef.current = null;
    setRoleLoading(false);
    setIsAdmin(false);
    setIsContractor(false);
    setIsFounder(false);
    setParentContractorId(null);
  };

  const checkUserRole = async (userId: string) => {
    roleLookupUserRef.current = userId;
    setRoleLoading(true);

    const applyRoleResult = (result: any) => {
      if (roleLookupUserRef.current !== userId) return;
      const { data: profile, error } = result ?? {};
      if (error || !profile) { resetRole(); return; }

      setIsAdmin(profile.role === 'admin');
      setIsContractor(profile.role === 'contractor');
      setIsFounder(!!profile.is_founder);
      setParentContractorId(profile.parent_contractor_id ?? null);
      setRoleLoading(false);
    };

    try {
      const roleLookup = supabase
        .from('profiles')
        .select('role, is_founder, parent_contractor_id')
        .eq('id', userId)
        .single();

      let timeoutId: number | undefined;
      const result = await Promise.race([
        roleLookup,
        new Promise<{ timedOut: true }>((resolve) => {
          timeoutId = window.setTimeout(() => resolve({ timedOut: true }), 10000);
        }),
      ]);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);

      // On timeout, keep whatever role state we already have rather than
      // wrongly downgrading an admin to a non-admin while the network is slow.
      if ('timedOut' in result) {
        Promise.resolve(roleLookup).then(applyRoleResult).catch((e) => {
          console.warn('[Auth] Late role lookup failed:', e);
          if (roleLookupUserRef.current === userId) setRoleLoading(false);
        });
        return;
      }

      applyRoleResult(result);
    } catch (e) {
      console.warn('[Auth] Role lookup failed:', e);
      // Keep prior role state on transient errors.
      if (roleLookupUserRef.current === userId) setRoleLoading(false);
    }
  };

  const applySession = async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (nextSession?.refresh_token && nextSession?.access_token) {
      setStorageItem(
        SESSION_BACKUP_KEY,
        JSON.stringify({
          access_token: nextSession.access_token,
          refresh_token: nextSession.refresh_token,
        })
      );
    } else {
      removeStorageItem(SESSION_BACKUP_KEY);
    }

    if (nextSession?.user) {
      await checkUserRole(nextSession.user.id);
      return;
    }

    resetRole();
  };

  const recoverSession = async (): Promise<Session | null> => {
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current;

    recoveryPromiseRef.current = (async () => {
      try {
        const {
          data: { session: current },
        } = await supabase.auth.getSession();

        if (current?.user) return current;

        const backup = readSessionBackup();
        if (!backup) return null;

        const { data: restored, error } = await supabase.auth.setSession(backup);
        if (error || !restored.session?.user) {
          removeStorageItem(SESSION_BACKUP_KEY);
          return null;
        }

        return restored.session;
      } catch (e) {
        console.warn('[Auth] Session recovery failed:', e);
        return null;
      }
    })();

    try {
      return await recoveryPromiseRef.current;
    } finally {
      recoveryPromiseRef.current = null;
    }
  };

  const recoverSessionWithTimeout = async (timeoutMs = 4000): Promise<Session | null> => {
    let timeoutId: number | undefined;

    try {
      return await Promise.race([
        recoverSession(),
        new Promise<null>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  useEffect(() => {
    const processAuthStateChange = async (event: string, incomingSession: Session | null) => {
      try {
        if (event === 'SIGNED_OUT') {
          const isExplicitSignOut = getStorageItem(EXPLICIT_SIGN_OUT_KEY) === '1';

          if (isExplicitSignOut) {
            removeStorageItem(EXPLICIT_SIGN_OUT_KEY);
            await applySession(null);
            return;
          }

          const recovered = await recoverSessionWithTimeout();
          await applySession(recovered);
          return;
        }

        // Two-step sign-in (before bank linking in Financial Pulse) only raises the session's level for the
        // same user, so keep the role: the role lookup's loading screen would close the page mid-step.
        if (event === 'MFA_CHALLENGE_VERIFIED' && incomingSession?.user && incomingSession.user.id === userIdRef.current) {
          setSession(incomingSession);
          setUser(incomingSession.user);
          if (incomingSession.access_token && incomingSession.refresh_token) {
            setStorageItem(
              SESSION_BACKUP_KEY,
              JSON.stringify({
                access_token: incomingSession.access_token,
                refresh_token: incomingSession.refresh_token,
              })
            );
          }
          return;
        }

        if (incomingSession?.user) {
          await applySession(incomingSession);
          return;
        }

        await applySession(null);
      } catch (e) {
        console.warn('[Auth] Auth state change failed:', e);
      } finally {
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, incomingSession) => {
      // Keep callback synchronous to avoid auth lockups during sign-in.
      void processAuthStateChange(event, incomingSession);
    });

    const bootstrap = async () => {
      try {
        const recovered = await recoverSessionWithTimeout();
        await applySession(recovered);
      } catch (e) {
        console.warn('[Auth] Bootstrap failed:', e);
      } finally {
        setLoading(false);
      }
    };

    const keepAlive = async () => {
      try {
        const recovered = await recoverSessionWithTimeout();
        if (recovered?.user) {
          // If same user is already set, just update token backup silently
          // to avoid state flicker that disables all queries
          if (userIdRef.current === recovered.user.id) {
            setStorageItem(
              SESSION_BACKUP_KEY,
              JSON.stringify({
                access_token: recovered.access_token,
                refresh_token: recovered.refresh_token,
              })
            );
          } else {
            await applySession(recovered);
          }
        }
      } catch (e) {
        console.warn('[Auth] KeepAlive failed:', e);
      }
    };

    void bootstrap();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void keepAlive();
      }
    };

    const handleFocus = () => {
      void keepAlive();
    };

    const handleOnline = () => {
      void keepAlive();
    };

    const keepAliveInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void keepAlive();
      }
    }, 5 * 60 * 1000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      subscription.unsubscribe();
      clearInterval(keepAliveInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    removeStorageItem(EXPLICIT_SIGN_OUT_KEY);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Unable to sign in. Please try again.');
      return { error };
    }
  };

  const signOut = async () => {
    setStorageItem(EXPLICIT_SIGN_OUT_KEY, '1');
    // Revoke device push tokens for this user before clearing the session
    // (best-effort; never blocks sign-out).
    try {
      const uid = user?.id;
      if (uid) {
        await supabase
          .from('device_tokens')
          .update({ revoked_at: new Date().toISOString() })
          .eq('contractor_id', uid)
          .is('revoked_at', null);
      }
    } catch (e) {
      console.warn('[auth] failed to revoke device tokens on sign-out', e);
    }
    await supabase.auth.signOut();
    await applySession(null);
  };


  return (
    <AuthContext.Provider value={{
      user, session, loading, roleLoading, isAdmin, isContractor,
      isFounder,
      parentContractorId,
      effectiveContractorId: parentContractorId ?? user?.id ?? null,
      isTeamMember: !!parentContractorId,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}


