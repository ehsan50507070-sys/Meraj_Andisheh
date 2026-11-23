import type { HeroSlide, HomeShelf, StaticPage } from '../domain/layout';

export interface ILayoutRepository {
  getAllHeroSlides(): Promise<HeroSlide[]>;
  getHeroSlideById(id: number): Promise<HeroSlide | null>;
  createHeroSlide(slide: Omit<HeroSlide, 'id'>): Promise<HeroSlide>;
  updateHeroSlide(slide: HeroSlide): Promise<HeroSlide>;
  deleteHeroSlide(id: number): Promise<void>;

  getAllHomeShelves(): Promise<HomeShelf[]>;
  getHomeShelfById(id: number): Promise<HomeShelf | null>;
  createHomeShelf(shelf: Omit<HomeShelf, 'id'>): Promise<HomeShelf>;
  updateHomeShelf(shelf: HomeShelf): Promise<HomeShelf>;
  deleteHomeShelf(id: number): Promise<void>;

  getAllStaticPages(): Promise<StaticPage[]>;
  getStaticPageById(id: number): Promise<StaticPage | null>;
  getStaticPageBySlug(slug: string): Promise<StaticPage | null>;
  createStaticPage(page: Omit<StaticPage, 'id'>): Promise<StaticPage>;
  updateStaticPage(page: StaticPage): Promise<StaticPage>;
  deleteStaticPage(id: number): Promise<void>;
}
