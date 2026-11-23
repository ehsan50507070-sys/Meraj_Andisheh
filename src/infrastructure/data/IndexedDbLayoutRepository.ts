import type { ILayoutRepository } from '../../core/abstractions/layoutRepository';
import type { HeroSlide, HomeShelf, StaticPage } from '../../core/domain/layout';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbLayoutRepository implements ILayoutRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getAllHeroSlides(): Promise<HeroSlide[]> {
    return this.dataStore.getAll<HeroSlide>(STORE_NAMES.HERO_SLIDES);
  }

  public async getHeroSlideById(id: number): Promise<HeroSlide | null> {
    return this.dataStore.getByKey<HeroSlide>(STORE_NAMES.HERO_SLIDES, id);
  }

  public async createHeroSlide(slide: Omit<HeroSlide, 'id'>): Promise<HeroSlide> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.HERO_SLIDES, slide);
    return { ...slide, id };
  }

  public async updateHeroSlide(slide: HeroSlide): Promise<HeroSlide> {
    await this.dataStore.putRecord(STORE_NAMES.HERO_SLIDES, slide);
    return { ...slide };
  }

  public async deleteHeroSlide(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.HERO_SLIDES, id);
  }

  public async getAllHomeShelves(): Promise<HomeShelf[]> {
    return this.dataStore.getAll<HomeShelf>(STORE_NAMES.HOME_SHELVES);
  }

  public async getHomeShelfById(id: number): Promise<HomeShelf | null> {
    return this.dataStore.getByKey<HomeShelf>(STORE_NAMES.HOME_SHELVES, id);
  }

  public async createHomeShelf(shelf: Omit<HomeShelf, 'id'>): Promise<HomeShelf> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.HOME_SHELVES, shelf);
    return { ...shelf, id };
  }

  public async updateHomeShelf(shelf: HomeShelf): Promise<HomeShelf> {
    await this.dataStore.putRecord(STORE_NAMES.HOME_SHELVES, shelf);
    return { ...shelf };
  }

  public async deleteHomeShelf(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.HOME_SHELVES, id);
  }

  public async getAllStaticPages(): Promise<StaticPage[]> {
    return this.dataStore.getAll<StaticPage>(STORE_NAMES.STATIC_PAGES);
  }

  public async getStaticPageById(id: number): Promise<StaticPage | null> {
    return this.dataStore.getByKey<StaticPage>(STORE_NAMES.STATIC_PAGES, id);
  }

  public async getStaticPageBySlug(slug: string): Promise<StaticPage | null> {
    return this.dataStore.getByIndex<StaticPage>(
      STORE_NAMES.STATIC_PAGES,
      'by_slug',
      slug,
    );
  }

  public async createStaticPage(page: Omit<StaticPage, 'id'>): Promise<StaticPage> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.STATIC_PAGES, page);
    return { ...page, id };
  }

  public async updateStaticPage(page: StaticPage): Promise<StaticPage> {
    await this.dataStore.putRecord(STORE_NAMES.STATIC_PAGES, page);
    return { ...page };
  }

  public async deleteStaticPage(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.STATIC_PAGES, id);
  }
}
