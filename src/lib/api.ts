import { getIdToken } from '@/lib/firebaseAuth';
import { resolveApiBases } from '@/lib/appDomains';
import type { User, Listing, Offer, Thread, Message, Rating, Community } from '@/types';

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html');
}

function shouldRetryOnAnotherBase(response: Response, isLast: boolean): boolean {
  if (isHtmlResponse(response)) return !isLast;
  return !isLast && (response.status === 401 || response.status === 404 || response.status >= 500);
}

async function fetchWithFailover(endpoint: string, options: RequestInit): Promise<Response> {
  const bases = resolveApiBases();
  let lastResponse: Response | null = null;

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const isLast = i === bases.length - 1;
    try {
      const response = await fetch(`${base}${endpoint}`, options);
      if (shouldRetryOnAnotherBase(response, isLast)) {
        lastResponse = response;
        continue;
      }
      if (isLast && isHtmlResponse(response)) {
        throw new ApiError(
          `API returned HTML instead of JSON from ${base}${endpoint}. Check that /api routes are deployed on this host.`,
          502,
        );
      }
      return response;
    } catch (err) {
      if (!isLast) continue;
      throw err;
    }
  }
  if (lastResponse && isHtmlResponse(lastResponse)) {
    throw new ApiError('API returned HTML instead of JSON. Check Vercel /api deployment.', 502);
  }
  return lastResponse!;
}

// Error thrown by the API client. Carries the HTTP status so callers (and the
// global 401 handler) can react to it.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Registered by AuthContext so a 401 from any request can drive a logout +
// redirect instead of leaving the user with a valid-looking but dead session.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
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
    let token: string | null = null;
    try {
      token = await getIdToken();
    } catch (err) {
      throw new ApiError(
        (err as Error)?.message || 'Could not get a sign-in token. Try signing out and back in.',
        401,
      );
    }
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

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
        onUnauthorized?.();
      }
      throw new ApiError(
        data?.error ||
        data?.message ||
        data?.msg ||
        (response.status === 401 ? 'Session expired. Please log in again.' : `Request failed (${response.status})`),
        response.status
      );
    }

    return data as T;
  }

  private static async uploadFile(endpoint: string, file: File): Promise<{ url: string }> {
    const token = await getIdToken();
    const formData = new FormData();
    formData.append('file', file);
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetchWithFailover(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    return data as { url: string };
  }

  // Auth — sign-in/up/reset now run client-side via @/lib/firebaseAuth; the
  // backend only resolves the app profile for the current Firebase identity
  // (auto-provisioning one on first call). The Firebase ID token is attached as
  // the bearer by `request()`.
  static async getMe(): Promise<{ user: User }> {
    const data = await this.request<{ user: User }>('/auth/me');
    if (data.user) {
      AuthManager.setUser(data.user);
    }
    return data;
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

  static async getListings(
    filters?: { communityId?: string; zipCode?: string; cursor?: string; limit?: number }
  ): Promise<{ listings: Listing[]; nextCursor: string | null }> {
    const entries = Object.entries(filters ?? {}).filter(([, v]) => v !== undefined && v !== '');
    const params = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
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

  // Push — register this device's FCM token for the signed-in user.
  static async registerPushToken(token: string): Promise<{ success: boolean }> {
    return this.request('/push/register', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }
}
