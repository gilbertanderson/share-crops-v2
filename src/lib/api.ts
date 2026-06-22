import { projectId, publicAnonKey } from '@/config/info';
import type { User, Listing, Offer, Thread, Message, Rating, Community } from '@/types';

// Primary backend: the Supabase Edge Function. Fallback: a Vercel-hosted
// deployment of the SAME Hono app (set VITE_FALLBACK_API_URL to e.g.
// https://<app>.vercel.app/api/make-server-dd877831). When the primary is
// unreachable or returns a server error, requests retry against the fallback.
const PRIMARY_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-dd877831`;
const FALLBACK_BASE = (import.meta.env.VITE_FALLBACK_API_URL || '').replace(/\/$/, '');
const BASES = [PRIMARY_BASE, ...(FALLBACK_BASE ? [FALLBACK_BASE] : [])];

async function fetchWithFailover(endpoint: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < BASES.length; i++) {
    const isLast = i === BASES.length - 1;
    try {
      const res = await fetch(`${BASES[i]}${endpoint}`, init);
      // A server-side failure (5xx/429) on a non-final base → try the fallback.
      // 4xx responses are legitimate answers and are returned as-is.
      if (!isLast && (res.status >= 500 || res.status === 429)) continue;
      return res;
    } catch (e) {
      // Network error / backend down → try the next base.
      lastErr = e;
      if (isLast) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All backends unreachable');
}

export class AuthManager {
  private static TOKEN_KEY = 'sharecrops_token';
  private static USER_KEY = 'sharecrops_user';
  private static COMMUNITY_SELECTED_KEY = 'sharecrops_community_selected';

  static getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  static setToken(token: string) {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  static clearToken() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    sessionStorage.removeItem(this.COMMUNITY_SELECTED_KEY);
  }

  static getUser(): User | null {
    const user = localStorage.getItem(this.USER_KEY);
    return user ? JSON.parse(user) : null;
  }

  static setUser(user: User) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  static isAuthenticated(): boolean {
    return !!this.getToken();
  }

  static hasSelectedCommunityThisSession(): boolean {
    return sessionStorage.getItem(this.COMMUNITY_SELECTED_KEY) === 'true';
  }

  static markCommunitySelected() {
    sessionStorage.setItem(this.COMMUNITY_SELECTED_KEY, 'true');
  }

  static resetCommunitySelection() {
    sessionStorage.removeItem(this.COMMUNITY_SELECTED_KEY);
  }
}

export class API {
  private static async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = AuthManager.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || publicAnonKey}`,
      ...options.headers,
    };

    const response = await fetchWithFailover(endpoint, {
      ...options,
      headers,
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      if (response.status === 401) {
        AuthManager.clearToken();
      }
      throw new Error(
        data?.error ||
        data?.message ||
        data?.msg ||
        (response.status === 401 ? 'Session expired. Please log in again.' : `Request failed (${response.status})`)
      );
    }

    return data as T;
  }

  private static async uploadFile(endpoint: string, file: File): Promise<{ url: string }> {
    const token = AuthManager.getToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetchWithFailover(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token || publicAnonKey}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    return data as { url: string };
  }

  // Auth
  static async signup(email: string, password: string, name: string): Promise<{ user: User; accessToken: string }> {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  static async login(email: string, password: string): Promise<{ user: User; accessToken: string }> {
    const data = await this.request<{ user: User; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.accessToken) {
      AuthManager.setToken(data.accessToken);
      AuthManager.resetCommunitySelection();
    }

    return data;
  }

  static async getMe(): Promise<{ user: User }> {
    const data = await this.request<{ user: User }>('/auth/me');
    if (data.user) {
      AuthManager.setUser(data.user);
    }
    return data;
  }

  static async resetPassword(email: string): Promise<{ success: boolean }> {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  }

  // OAuth
  static async signInWithOAuth(provider: 'google' = 'google'): Promise<void> {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      throw new Error(error.message || `${provider} sign-in failed`);
    }
  }

  // Communities
  static async createCommunity(name: string, zipCode: string): Promise<{ community: Community }> {
    return this.request('/communities', {
      method: 'POST',
      body: JSON.stringify({ name, zipCode }),
    });
  }

  static async joinCommunity(communityId: string): Promise<{ community: Community }> {
    return this.request('/communities/join', {
      method: 'POST',
      body: JSON.stringify({ communityId }),
    });
  }

  static async searchCommunities(zipCode: string): Promise<{ communities: Community[] }> {
    return this.request(`/communities/search?zipCode=${zipCode}`);
  }

  static async getMyCommunity(): Promise<{ community: Community | null }> {
    return this.request('/communities/my');
  }

  static async getMyCommunities(): Promise<{ communities: Community[]; activeCommunityId: string | null }> {
    return this.request('/communities/mine');
  }

  static async setActiveCommunity(communityId: string): Promise<{ community: Community }> {
    return this.request('/communities/active', {
      method: 'POST',
      body: JSON.stringify({ communityId }),
    });
  }

  static async leaveCommunity(communityId: string): Promise<{ success: boolean }> {
    return this.request(`/communities/mine/${communityId}`, {
      method: 'DELETE',
    });
  }

  static async getAllCommunities(): Promise<{ communities: Community[] }> {
    return this.request('/communities/all');
  }

  static async getCommunityMembersPreview(communityId: string): Promise<{ members: Array<{ id: string; name: string; profilePhotoUrl: string | null }> }> {
    return this.request(`/communities/${communityId}/members/preview`);
  }

  static async getCommunityMembers(communityId: string): Promise<{ members: User[] }> {
    return this.request(`/communities/${communityId}/members`);
  }

  static async removeCommunityMember(communityId: string, userId: string): Promise<{ success: boolean }> {
    return this.request(`/communities/${communityId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  // Listings
  static async createListing(data: {
    title: string;
    description: string;
    quantity: string;
    photos: string[];
    lookingFor?: string;
    expiresInDays: number;
  }): Promise<{ listing: Listing }> {
    return this.request('/listings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // AI-drafted listing description (Claude, server-side, prompt-cached).
  static async draftListingDescription(title: string, notes?: string): Promise<{
    description: string;
    usage: { inputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; outputTokens: number };
  }> {
    return this.request('/listings/draft-description', {
      method: 'POST',
      body: JSON.stringify({ title, notes }),
    });
  }

  static async getListings(filters?: { communityId?: string; zipCode?: string }): Promise<{ listings: Listing[] }> {
    const params = filters ? new URLSearchParams(filters as Record<string, string>).toString() : '';
    return this.request(`/listings${params ? `?${params}` : ''}`);
  }

  static async getListing(id: string): Promise<{ listing: Listing }> {
    return this.request(`/listings/${id}`);
  }

  static async deleteListing(id: string): Promise<{ success: boolean }> {
    return this.request(`/listings/${id}`, {
      method: 'DELETE',
    });
  }

  static async getUserListings(userId: string): Promise<{ listings: Listing[] }> {
    return this.request(`/listings/user/${userId}`);
  }

  // Offers
  static async createOffer(listingId: string, offeredProduce: string, message?: string): Promise<{ offer: Offer }> {
    return this.request('/offers', {
      method: 'POST',
      body: JSON.stringify({ listingId, offeredProduce, message }),
    });
  }

  static async deleteOffer(offerId: string): Promise<{ success: boolean }> {
    return this.request(`/offers/${offerId}`, {
      method: 'DELETE',
    });
  }

  static async acceptOffer(offerId: string): Promise<{ offer: Offer }> {
    return this.request(`/offers/${offerId}/accept`, { method: 'POST' });
  }

  static async declineOffer(offerId: string): Promise<{ offer: Offer }> {
    return this.request(`/offers/${offerId}/decline`, { method: 'POST' });
  }

  static async completeOffer(offerId: string): Promise<{ offer: Offer }> {
    return this.request(`/offers/${offerId}/complete`, { method: 'POST' });
  }

  static async getMyOffers(as?: 'buyer' | 'seller'): Promise<{ offers: Offer[] }> {
    return this.request(`/offers/my${as ? `?as=${as}` : ''}`);
  }

  // Chat
  static async createSupportThread(): Promise<{ thread: Thread }> {
    return this.request('/chat/support', { method: 'POST' });
  }

  static async createThread(listingId: string, otherUserId: string): Promise<{ thread: Thread }> {
    return this.request('/chat/threads', {
      method: 'POST',
      body: JSON.stringify({ listingId, otherUserId }),
    });
  }

  static async sendMessage(threadId: string, content: string): Promise<{ message: Message }> {
    return this.request('/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ threadId, content }),
    });
  }

  static async getThreads(): Promise<{ threads: Thread[] }> {
    return this.request('/chat/threads');
  }

  static async getMessages(threadId: string): Promise<{ messages: Message[] }> {
    return this.request(`/chat/messages/${threadId}`);
  }

  static async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return this.request(`/chat/messages/${messageId}`, { method: 'DELETE' });
  }

  // Ratings
  static async createRating(offerId: string, rating: number, comment?: string): Promise<{ rating: Rating }> {
    return this.request('/ratings', {
      method: 'POST',
      body: JSON.stringify({ offerId, rating, comment }),
    });
  }

  static async getUserRatings(userId: string): Promise<{ ratings: Rating[] }> {
    return this.request(`/ratings/user/${userId}`);
  }

  static async deleteRating(ratingId: string): Promise<{ success: boolean }> {
    return this.request(`/ratings/${ratingId}`, { method: 'DELETE' });
  }

  // Profile
  static async updateProfile(data: {
    name?: string;
    bio?: string;
    socialUrl?: string;
    profilePhotoUrl?: string;
  }): Promise<{ user: User }> {
    return this.request('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  static async getProfile(userId: string): Promise<{ profile: User }> {
    return this.request(`/profile/${userId}`);
  }

  // Trending
  static async getTrendingByZip(zipCode: string): Promise<{ items: Array<{ listing: Listing; offerCount: number }> }> {
    return this.request(`/trending/zip/${encodeURIComponent(zipCode)}`);
  }

  static async getTrendingByCommunity(communityId: string): Promise<{ items: Array<{ listing: Listing; offerCount: number }> }> {
    return this.request(`/trending/community/${encodeURIComponent(communityId)}`);
  }

  // Upload
  static async uploadPhoto(file: File): Promise<{ url: string }> {
    return this.uploadFile('/upload', file);
  }
}
