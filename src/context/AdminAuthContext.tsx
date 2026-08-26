import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import {
  AdminUserRecord,
  checkAdminAuthorization,
  signOutAdmin,
  PRIMARY_ADMIN_EMAIL,
} from '../services/adminAuthService';

interface AdminAuthContextType {
  user: User | null;
  adminRecord: AdminUserRecord | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
  refreshAdminStatus: () => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  user: null,
  adminRecord: null,
  isAdmin: false,
  isSuperAdmin: false,
  loading: true,
  error: null,
  refreshAdminStatus: async () => {},
  logout: async () => {},
});

export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [adminRecord, setAdminRecord] = useState<AdminUserRecord | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const verifyUser = async (currentUser: User | null) => {
    setLoading(true);
    setError(null);

    if (!currentUser) {
      setUser(null);
      setAdminRecord(null);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setUser(currentUser);

    try {
      const authResult = await checkAdminAuthorization(currentUser);
      if (authResult.isAuthorized) {
        setIsAdmin(true);
        setAdminRecord(authResult.adminRecord);
        setError(null);
      } else {
        setIsAdmin(false);
        setAdminRecord(null);
        setError(authResult.error || 'Access Denied: You are not authorized as a PayFlux administrator.');
      }
    } catch (e: any) {
      console.error('Admin Auth Check Failed:', e);
      setIsAdmin(false);
      setAdminRecord(null);
      setError(e?.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      verifyUser(firebaseUser);
    });

    return () => unsubscribe();
  }, []);

  const refreshAdminStatus = async () => {
    if (auth.currentUser) {
      await verifyUser(auth.currentUser);
    }
  };

  const logout = async () => {
    await signOutAdmin();
    setUser(null);
    setAdminRecord(null);
    setIsAdmin(false);
    setError(null);
  };

  const isSuperAdmin =
    Boolean(isAdmin && (
      (user?.email && user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL) ||
      adminRecord?.role === 'superadmin'
    ));

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        adminRecord,
        isAdmin,
        isSuperAdmin,
        loading,
        error,
        refreshAdminStatus,
        logout,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = () => useContext(AdminAuthContext);
