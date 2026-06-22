import React from 'react';

// Inline line icons, ported from the prototype's atoms.jsx Icon map.
export const Icon = {
  search: (
    <svg className="search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  plus: (size = 16) => (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  back: (
    <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M15 19l-7-7 7-7" />
    </svg>
  ),
  bolt: (size = 14) => (
    <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
    </svg>
  ),
  check: (size = 14) => (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  send: (
    <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </svg>
  ),
  navMarket: (
    <svg className="icon" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M5 9v11h14V9" />
      <path d="M3 9h18" />
      <path d="M9 13h6" />
    </svg>
  ),
  navOffers: (
    <svg className="icon" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 7h18l-2 13H5L3 7Z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </svg>
  ),
  navMessages: (
    <svg className="icon" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4.3-1L3 20l1.4-3.7A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z" />
    </svg>
  ),
  navProfile: (
    <svg className="icon" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  message: (
    <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4.3-1L3 20l1.4-3.7A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z" />
    </svg>
  ),
  // Sprouting leaf — used as the neutral placeholder when a photo is missing.
  leaf: (size = 28) => (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
      <path d="M11 20A7 7 0 0 1 4 13c0-4 3-8 9-9 1 6-2 11-6 12" />
      <path d="M11 20c0-4 2-8 6-10" />
    </svg>
  ),
};
