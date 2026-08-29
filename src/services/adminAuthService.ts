import {
  User,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  getDocs,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { auth, googleAuthProvider, db } from '../config/firebase';

// Primary Root Admin authorized email (The PayFlux Owner / Admin)
export const PRIMARY_ADMIN_EMAIL = 'favournosakhare110@gmail.com'.toLowerCase();

export interface AdminUserRecord {
  uid: string;
  email: string;
  role: 'superadmin' | 'admin';
  name?: string;
  photoURL?: string;
  addedBy?: string;
  addedAt?: number;
  status: 'active' | 'revoked';
}

export interface AdminAuthSessionState {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  adminRecord: AdminUserRecord | null;
  error: string | null;
}

/**
 * Checks if a given email is the primary owner or in the verified admin list
 */
export function isEmailPrimaryAdmin(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL;
}

/**
 * Verifies if an authenticated user is authorized as an Admin in Firestore.
 * Automatically seeds the primary owner record if not yet created.
 */
export async function checkAdminAuthorization(user: User): Promise<{
  isAuthorized: boolean;
  adminRecord: AdminUserRecord | null;
  error: string | null;
}> {
  if (!user || !user.email) {
    return { isAuthorized: false, adminRecord: null, error: 'No authenticated user.' };
  }

  const userEmail = user.email.trim().toLowerCase();

  // Fast-path: Immediate verification for designated primary PayFlux owner
  if (userEmail === PRIMARY_ADMIN_EMAIL) {
    const defaultOwnerRecord: AdminUserRecord = {
      uid: user.uid,
      email: userEmail,
      role: 'superadmin',
      name: user.displayName || 'PayFlux Owner',
      photoURL: user.photoURL || undefined,
      addedBy: 'system_root',
      addedAt: Date.now(),
      status: 'active',
    };

    // Attempt background Firestore sync with 2.5s timeout, but do not block owner login
    try {
      const adminDocRef = doc(db, 'payflux_admins', user.uid);
      const fetchPromise = getDoc(adminDocRef);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
      
      const adminSnap = await Promise.race([fetchPromise, timeoutPromise]);
      if (adminSnap && 'exists' in adminSnap && adminSnap.exists()) {
        return { isAuthorized: true, adminRecord: adminSnap.data() as AdminUserRecord, error: null };
      } else if (adminSnap && 'exists' in adminSnap && !adminSnap.exists()) {
        // Asynchronously persist without blocking
        setDoc(adminDocRef, defaultOwnerRecord).catch((e) => console.warn('Background admin seed warning:', e));
      }
    } catch (err) {
      console.warn('Firestore offline/unreachable, granting verified primary owner session:', err);
    }

    return { isAuthorized: true, adminRecord: defaultOwnerRecord, error: null };
  }

  try {
    // Check if user has an assigned admin role in Firestore with a strict 3s timeout
    const adminDocRef = doc(db, 'payflux_admins', user.uid);
    const fetchDocPromise = getDoc(adminDocRef);
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    
    const adminSnap = await Promise.race([fetchDocPromise, timeoutPromise]);

    if (adminSnap && 'exists' in adminSnap && adminSnap.exists()) {
      const record = adminSnap.data() as AdminUserRecord;
      if (record.status === 'active') {
        return { isAuthorized: true, adminRecord: record, error: null };
      }
      return { isAuthorized: false, adminRecord: null, error: 'Admin access for this account has been revoked.' };
    }

    // Fallback: check if an admin invited by email exists
    const adminsCol = collection(db, 'payflux_admins');
    const q = query(adminsCol);
    const querySnapPromise = getDocs(q);
    const queryTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const querySnap = await Promise.race([querySnapPromise, queryTimeout]);
    
    if (querySnap && 'forEach' in querySnap) {
      let matched: AdminUserRecord | null = null;
      querySnap.forEach((d) => {
        const data = d.data() as AdminUserRecord;
        if (data.email && data.email.toLowerCase() === userEmail && data.status === 'active') {
          matched = data;
        }
      });

      if (matched) {
        return { isAuthorized: true, adminRecord: matched, error: null };
      }
    }

    return {
      isAuthorized: false,
      adminRecord: null,
      error: `Access Denied: ${userEmail} is not authorized as a PayFlux administrator.`,
    };
  } catch (err: any) {
    console.warn('Admin authorization Firestore query encountered error:', err);
    return {
      isAuthorized: false,
      adminRecord: null,
      error: err?.message || 'Failed to verify admin status.',
    };
  }
}

/**
 * Sign in using Google OAuth Popup
 */
export async function signInAdminWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleAuthProvider);
  return result.user;
}

/**
 * Sign in with email and password
 */
export async function signInAdminWithEmail(email: string, pass: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, pass);
  return res.user;
}

/**
 * Register / Create email and password account (for primary admin)
 */
export async function createAdminWithEmail(email: string, pass: string): Promise<User> {
  const res = await createUserWithEmailAndPassword(auth, email, pass);
  return res.user;
}

/**
 * Sign out admin session
 */
export async function signOutAdmin(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Expandable Admin Management: Fetch all registered admins (Only accessible by authenticated superadmin)
 */
export async function fetchAllRegisteredAdmins(): Promise<AdminUserRecord[]> {
  try {
    const colRef = collection(db, 'payflux_admins');
    const fetchPromise = getDocs(colRef);
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const snapshot = await Promise.race([fetchPromise, timeoutPromise]);
    
    const list: AdminUserRecord[] = [];
    if (snapshot && 'forEach' in snapshot) {
      snapshot.forEach((d) => {
        list.push(d.data() as AdminUserRecord);
      });
    }
    return list;
  } catch (e) {
    console.warn('Failed to fetch admin list or connection offline:', e);
    return [];
  }
}

/**
 * Expandable Admin Management: Add a new admin email
 */
export async function addNewAdmin(
  newAdminEmail: string,
  role: 'superadmin' | 'admin' = 'admin',
  currentAdminUser: User
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = newAdminEmail.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, message: 'Invalid email address.' };
  }

  try {
    // Generate unique doc key for pre-invited or active admin
    const docId = `admin_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const adminDocRef = doc(db, 'payflux_admins', docId);

    const record: AdminUserRecord = {
      uid: docId,
      email: cleanEmail,
      role,
      addedBy: currentAdminUser.email || currentAdminUser.uid,
      addedAt: Date.now(),
      status: 'active',
    };

    await setDoc(adminDocRef, record, { merge: true });
    return { success: true, message: `Successfully added ${cleanEmail} as PayFlux Admin.` };
  } catch (err: any) {
    console.error('Error adding admin:', err);
    return { success: false, message: err?.message || 'Failed to add admin.' };
  }
}

/**
 * Expandable Admin Management: Update or revoke admin status
 */
export async function updateAdminStatus(
  docId: string,
  targetEmail: string,
  newStatus: 'active' | 'revoked'
): Promise<{ success: boolean; message: string }> {
  if (targetEmail.toLowerCase() === PRIMARY_ADMIN_EMAIL && newStatus === 'revoked') {
    return { success: false, message: 'The primary PayFlux owner cannot be revoked.' };
  }

  try {
    const adminDocRef = doc(db, 'payflux_admins', docId);
    await setDoc(adminDocRef, { status: newStatus }, { merge: true });
    return { success: true, message: `Status updated to ${newStatus}.` };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Failed to update admin status.' };
  }
}
