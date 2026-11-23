import type { HeroSlide, HomeShelf, StaticPage } from '../../core/domain/layout';
import type { Topic } from '../../core/domain/taxonomy';
import { sanitizeHtml } from '../../core/services/htmlSanitizer';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export const STAGE18_LAYOUT_SEED_META_KEY = 'stage18_layout_seeded_v1';

export interface Stage18SeedResult {
  insertedStaticPages: number;
  insertedHomeShelves: number;
  insertedHeroSlides: number;
  skippedAlreadySeeded: boolean;
}

const INITIAL_STATIC_PAGES: ReadonlyArray<Omit<StaticPage, 'id'>> = [
  {
    slug: 'about',
    title: 'درباره‌ی ما',
    body: '<h2>درباره‌ی استودیو معراج اندیشه</h2><p>معراج اندیشه یک بانک محتوای فرهنگی، آموزشی و پژوهشی به زبان فارسی است که با هدف ارائه‌ی تجربه‌ای امن، متناسب با هر رده‌ی سنی و عمیق در حوزه‌های علوم انسانی، تاریخ، رسانه، پژوهش و مهارت‌های زندگی طراحی شده است.</p><h3>رویکرد رده‌بندی سنی</h3><p>در این سامانه، محتواها بر اساس سه رده‌ی سنی کودک، نوجوان و جوان و بزرگسال پالایش و اولویت‌بندی می‌شوند تا هر مخاطب در فضایی متناسب و خوانا به منابع معتبر دسترسی داشته باشد.</p>',
    showInFooter: true,
    sortOrder: 1,
  },
  {
    slug: 'contact',
    title: 'تماس با ما',
    body: '<h2>ارتباط با استودیو معراج اندیشه</h2><p>برای ارسال پیشنهادهای محتوایی، گزارش خطاهای فنی یا طرح پرسش‌های همکاری با تیم تحریریه و تولید، راه‌های زیر در اختیار شماست:</p><ul><li>ثبت مستقیم پیشنهاد موضوع از طریق بخش <strong>درخواست محتوا</strong> در حساب کاربری</li><li>ارسال پیام به نشانی پست الکترونیک رسمی استودیو (در اطلاعات ارتباطی دبیرخانه)</li></ul><p>تیم تحریریه تمامی پیام‌ها و درخواست‌های ثبت‌شده را در کوتاه‌ترین زمان بررسی و پاسخ‌گویی می‌کند.</p>',
    showInFooter: true,
    sortOrder: 2,
  },
  {
    slug: 'terms',
    title: 'قوانین و مقررات',
    body: '<h2>قوانین و ضوابط استفاده‌ی عمومی</h2><p>استفاده از محتواهای منتشرشده در استودیو معراج اندیشه برای مطالعه‌ی شخصی، پژوهش علمی و بهره‌برداری آموزشی با ذکر منبع آزاد و مورد استقبال است.</p><ul><li>رعایت ادب، احترام متقابل و دوری از درج پیوندهای تبلیغاتی در بخش دیدگاه‌ها الزامی است.</li><li>درج دیدگاه برای رده‌ی سنی کودک پیش از انتشار توسط ناظران سامانه بررسی و تأیید می‌شود.</li><li>مسئولیت استفاده از فایل‌های دانلودشده مطابق حقوق ناشران و پدیدآورندگان درج‌شده در بخش منابع است.</li></ul>',
    showInFooter: true,
    sortOrder: 3,
  },
  {
    slug: 'privacy',
    title: 'حریم خصوصی',
    body: '<h2>خط‌مشی حریم خصوصی کاربران</h2><p>صیانت از داده‌های کاربران و ایمنی کودکان از اصول بنیادین طراحی این سامانه است.</p><ul><li>انتخاب رده‌ی سنی بازدیدکنندگان تنها در مرورگر (کوکی <code>ma_age</code>) یا در پروفایل کاربری نگهداری می‌شود.</li><li>شما در هر زمان می‌توانید از بخش تنظیمات حساب کاربری، کل داده‌های هویتی، علاقه‌مندی‌ها و لایک‌های خود را به‌صورت کامل حذف کنید.</li><li>در صورت حذف حساب، داده‌های آماری بازدید و دانلود بدون پیوند به هویت شما و دیدگاه‌ها با عنوان «کاربر حذف‌شده» ناشناس می‌شوند.</li></ul>',
    showInFooter: true,
    sortOrder: 4,
  },
];

const INITIAL_HERO_SLIDES: ReadonlyArray<Omit<HeroSlide, 'id'>> = [
  {
    title: 'به بانک محتوای معراج اندیشه خوش آمدید',
    subtitle:
      'مطالعه و تماشای محتوای برگزیده‌ی علمی، تاریخی و فرهنگی با تجربه‌ی متناسب با رده‌ی سنی شما',
    imageKey: null,
    linkUrl: '#/content',
    sortOrder: 1,
    isActive: true,
    ageGroupId: null,
  },
  {
    title: 'آثار پربازدید و پیشنهاد موضوع جدید',
    subtitle:
      'محبوب‌ترین محتواهای هفته را مرور کنید یا موضوع مورد نیاز خود را برای تیم تولید پیشنهاد دهید.',
    imageKey: null,
    linkUrl: '#/content?sort=most_viewed',
    sortOrder: 2,
    isActive: true,
    ageGroupId: null,
  },
];

export async function ensureStage18LayoutSeededAsync(
  dataStore: IndexedDbDataStore,
): Promise<Stage18SeedResult> {
  const existingPages = await dataStore.getAll<StaticPage>(STORE_NAMES.STATIC_PAGES);
  const existingShelves = await dataStore.getAll<HomeShelf>(STORE_NAMES.HOME_SHELVES);
  const existingSlides = await dataStore.getAll<HeroSlide>(STORE_NAMES.HERO_SLIDES);

  const meta = await dataStore.getMeta(STAGE18_LAYOUT_SEED_META_KEY);
  if (
    meta &&
    existingPages.length >= INITIAL_STATIC_PAGES.length &&
    existingShelves.length > 0 &&
    existingSlides.length > 0
  ) {
    return {
      insertedStaticPages: 0,
      insertedHomeShelves: 0,
      insertedHeroSlides: 0,
      skippedAlreadySeeded: true,
    };
  }

  let insertedStaticPages = 0;
  const existingSlugs = new Set(existingPages.map((p) => p.slug.toLowerCase()));
  for (const page of INITIAL_STATIC_PAGES) {
    if (!existingSlugs.has(page.slug)) {
      await dataStore.addRecordWithAutoId(STORE_NAMES.STATIC_PAGES, {
        ...page,
        body: sanitizeHtml(page.body),
      });
      existingSlugs.add(page.slug);
      insertedStaticPages += 1;
    }
  }

  let insertedHomeShelves = 0;
  if (existingShelves.length === 0) {
    const topics = await dataStore.getAll<Topic>(STORE_NAMES.TOPICS);
    const rootTopics = topics
      .filter((t) => t.isActive && t.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const shelvesToSeed: Array<Omit<HomeShelf, 'id'>> = [
      {
        title: 'پیشنهادهای شما',
        type: 'Personalized',
        topicId: null,
        sortOrder: 1,
        isVisible: true,
      },
      {
        title: 'برگزیده‌های استودیو',
        type: 'Featured',
        topicId: null,
        sortOrder: 2,
        isVisible: true,
      },
      {
        title: 'برترین‌های هفته',
        type: 'Trending',
        topicId: null,
        sortOrder: 3,
        isVisible: true,
      },
      {
        title: 'تازه‌ترین محتواها',
        type: 'Latest',
        topicId: null,
        sortOrder: 4,
        isVisible: true,
      },
    ];

    if (rootTopics.length >= 1) {
      shelvesToSeed.push({
        title: `تازه‌های ${rootTopics[0].name}`,
        type: 'ByTopic',
        topicId: rootTopics[0].id,
        sortOrder: 5,
        isVisible: true,
      });
    }
    if (rootTopics.length >= 2) {
      shelvesToSeed.push({
        title: `گزیده‌ی ${rootTopics[1].name}`,
        type: 'ByTopic',
        topicId: rootTopics[1].id,
        sortOrder: 6,
        isVisible: true,
      });
    }

    for (const shelf of shelvesToSeed) {
      await dataStore.addRecordWithAutoId(STORE_NAMES.HOME_SHELVES, shelf);
      insertedHomeShelves += 1;
    }
  }

  let insertedHeroSlides = 0;
  if (existingSlides.length === 0) {
    for (const slide of INITIAL_HERO_SLIDES) {
      await dataStore.addRecordWithAutoId(STORE_NAMES.HERO_SLIDES, slide);
      insertedHeroSlides += 1;
    }
  }

  await dataStore.setMeta({
    key: STAGE18_LAYOUT_SEED_META_KEY,
    value: '1',
    updatedAtUtc: new Date().toISOString(),
  });

  return {
    insertedStaticPages,
    insertedHomeShelves,
    insertedHeroSlides,
    skippedAlreadySeeded: false,
  };
}
