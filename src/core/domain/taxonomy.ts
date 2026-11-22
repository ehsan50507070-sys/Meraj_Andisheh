import type { ThemeKey } from '../services/themeService';

export type AgeGroupKey = 'child' | 'teen' | 'youth' | 'adult';

export interface AgeGroup {
  id: number;
  key: AgeGroupKey;
  name: string;
  minAge: number;
  maxAge: number | null;
  themeKey: ThemeKey;
  sortOrder: number;
  isActive: boolean;
}

export interface Topic {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
}

export interface Person {
  id: number;
  name: string;
  slug: string;
  /** Maximum 1000 characters */
  bio: string;
  photoKey: string | null;
}

export interface ImpactLevel {
  id: number;
  name: string;
  sortOrder: number;
}
