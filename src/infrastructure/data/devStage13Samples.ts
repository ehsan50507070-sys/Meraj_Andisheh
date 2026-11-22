import type { IAuthRepository } from '../../core/abstractions/authRepository';
import type { IClock } from '../../core/abstractions/IClock';
import type { IContentRepository } from '../../core/abstractions/contentRepository';
import type { IFileStorage } from '../../core/abstractions/fileStorage';
import type { ISearchNormalizer } from '../../core/abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../../core/abstractions/taxonomyRepository';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentFormat,
} from '../../core/domain/content';

function buildMinimalValidPdfBytes(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length 73 >>\nstream\nBT /F1 20 Tf 72 700 Td (Meraj Andisheh Sample PDF Document) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

// Valid minimal 1x1 PNG (teal accent)
function buildMinimalValidPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0x18, 0xa5, 0x92, 0x01,
    0x00, 0x02, 0x0b, 0x01, 0x2a, 0x7c, 0x3b, 0x1d,
    0x2f, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function buildMinimalMp4Bytes(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
  ]);
}

function buildMinimalMp3Bytes(): Uint8Array {
  return new Uint8Array([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a,
    0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function buildMinimalZipOfficeBytes(): Uint8Array {
  return new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

export async function seedDevAllFormatsSamplesAsync(deps: {
  authRepository: IAuthRepository;
  contentRepository: IContentRepository;
  taxonomyRepository: ITaxonomyRepository;
  fileStorage: IFileStorage;
  searchNormalizer: ISearchNormalizer;
  clock: IClock;
}): Promise<{ insertedCount: number }> {
  const {
    authRepository,
    contentRepository,
    taxonomyRepository,
    fileStorage,
    searchNormalizer,
    clock,
  } = deps;

  const [users, topics, impacts, ageGroups] = await Promise.all([
    authRepository.getAllUsers(),
    taxonomyRepository.getAllTopics(),
    taxonomyRepository.getAllImpactLevels(),
    taxonomyRepository.getAllAgeGroups(),
  ]);

  let creator = users.find((u) => u.role === 'SuperAdmin' || u.role === 'Staff') ?? users[0];
  if (!creator) {
    const fallbackAgeId = ageGroups[0]?.id ?? 1;
    creator = await authRepository.createUser({
      email: 'dev-sample-author@meraj.local',
      normalizedEmail: 'DEV-SAMPLE-AUTHOR@MERAJ.LOCAL',
      phoneNumber: null,
      normalizedPhoneNumber: null,
      displayName: 'نویسنده نمونه توسعه',
      role: 'Staff',
      ageGroupId: fallbackAgeId,
      personalizationEnabled: false,
      emailConfirmed: true,
      phoneNumberConfirmed: false,
      mustChangePassword: false,
      isActive: true,
      failedLoginCount: 0,
      lockoutEnd: null,
      passwordHash: 'dev-sample-hash',
      passwordSalt: 'dev-sample-salt',
      createdAt: clock.nowUtcIso(),
      lastLoginAt: null,
    });
  }

  const rootTopic = topics.find((t) => t.isActive && t.parentId === null) ?? topics[0];
  const childTopic = topics.find((t) => t.isActive && t.parentId !== null) ?? rootTopic;
  const primaryTopicIds = Array.from(
    new Set([childTopic?.id, rootTopic?.id].filter((id): id is number => typeof id === 'number')),
  );

  const defaultImpactId = impacts[0]?.id ?? null;
  const nowIso = clock.nowUtcIso();

  const existingTags = await taxonomyRepository.getAllTags();
  let sampleTag = existingTags.find((tg) => tg.slug === 'sample-library');
  if (!sampleTag) {
    sampleTag = await taxonomyRepository.createTag({
      name: 'کتابخانه نمونه',
      slug: 'sample-library',
    });
  }

  const existingPersons = await taxonomyRepository.getAllPersons();
  let samplePerson = existingPersons.find((p) => p.slug === 'dr-meraj-sample');
  if (!samplePerson) {
    samplePerson = await taxonomyRepository.createPerson({
      name: 'استاد نمونه اندیشه',
      slug: 'dr-meraj-sample',
      bio: 'پژوهشگر حوزه اندیشه و فرهنگ در سامانه آزمایشی معراج.',
      photoKey: null,
    });
  }

  const sampleSpecs: Array<{
    slug: string;
    title: string;
    summary: string;
    body: string | null;
    format: ContentFormat;
    readWatchMinutes: number;
    prepareFiles: () => Promise<
      Array<{
        kind: ContentFileKind;
        storageType: FileStorageType;
        storageKey: string | null;
        externalUrl: string | null;
        originalFileName: string;
        mimeType: string;
        sizeBytes: number | null;
      }>
    >;
  }> = [
    {
      slug: 'sample-video-local',
      title: 'نمونه ویدیوی درونسایتی (MP4 محلی)',
      summary: 'ویدیوی آزمایشی ذخیره‌شده در مخزن امن برای بررسی پخش‌کننده HTML5 و تغییر سرعت.',
      body: '<p>این محتوا برای آزمایش پخش‌کننده ویدیوی محلی و کنترل سرعت پخش ساخته شده است.</p>',
      format: 'Video',
      readWatchMinutes: 12,
      prepareFiles: async () => {
        const saved = await fileStorage.saveAsync({
          bytes: buildMinimalMp4Bytes(),
          originalFileName: 'sample-video.mp4',
          contentType: 'video/mp4',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: saved.originalFileName,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-video-aparat',
      title: 'نمونه ویدیوی آپارات (Embed امن)',
      summary: 'نمونه ویدیوی متصل به لینک آپارات برای بررسی iframe واکنش‌گرای ۱۶:۹.',
      body: null,
      format: 'Video',
      readWatchMinutes: 18,
      prepareFiles: async () => [
        {
          kind: ContentFileKind.Main,
          storageType: FileStorageType.External,
          storageKey: null,
          externalUrl: 'https://www.aparat.com/v/y197v60',
          originalFileName: 'aparat-video',
          mimeType: 'text/html',
          sizeBytes: null,
        },
      ],
    },
    {
      slug: 'sample-audio',
      title: 'نمونه پادکست صوتی درونسایتی (MP3)',
      summary: 'فایل صوتی آزمایشی همراه با دکمه ۱۵ ثانیه جلو/عقب و کنترل سرعت.',
      body: '<p>خلاصه متنی فایل صوتی برای مطالعه هم‌زمان با شنیدن محتوا.</p>',
      format: 'Audio',
      readWatchMinutes: 9,
      prepareFiles: async () => {
        const saved = await fileStorage.saveAsync({
          bytes: buildMinimalMp3Bytes(),
          originalFileName: 'sample-podcast.mp3',
          contentType: 'audio/mpeg',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: saved.originalFileName,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-image',
      title: 'نمونه اینفوگرافیک و تصویر با بزرگنمایی',
      summary: 'تصویر آزمایشی برای بررسی نوار بزرگنمایی (+ / - / ۱۰۰٪) و نمایش تمام‌صفحه.',
      body: null,
      format: 'Image',
      readWatchMinutes: 3,
      prepareFiles: async () => {
        const saved = await fileStorage.saveAsync({
          bytes: buildMinimalValidPngBytes(),
          originalFileName: 'sample-infographic.png',
          contentType: 'image/png',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: saved.originalFileName,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-pdf',
      title: 'نمونه جزوه و سند PDF درونسایتی',
      summary: 'سند PDF آزمایشی قابل نمایش به‌صورت صفحه‌به‌صفحه بدون وابستگی به CDN.',
      body: null,
      format: 'Pdf',
      readWatchMinutes: 15,
      prepareFiles: async () => {
        const saved = await fileStorage.saveAsync({
          bytes: buildMinimalValidPdfBytes(),
          originalFileName: 'sample-booklet.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: saved.originalFileName,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-presentation',
      title: 'نمونه ارائه پاورپوینت با پیش‌نمایش PDF',
      summary: 'فایل پاورپوینت آزمایشی همراه با پیش‌نمایش PDF اسلایدها و کارت وضعیت مرحله ۱۴.',
      body: null,
      format: 'Presentation',
      readWatchMinutes: 20,
      prepareFiles: async () => {
        const mainPptx = await fileStorage.saveAsync({
          bytes: buildMinimalZipOfficeBytes(),
          originalFileName: 'sample-slides.pptx',
          contentType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          visibility: 'private',
          uploadedById: creator.id,
        });
        const previewPdf = await fileStorage.saveAsync({
          bytes: buildMinimalValidPdfBytes(),
          originalFileName: 'sample-slides-preview.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: mainPptx.storageKey,
            externalUrl: null,
            originalFileName: mainPptx.originalFileName,
            mimeType: mainPptx.mimeType,
            sizeBytes: mainPptx.sizeBytes,
          },
          {
            kind: ContentFileKind.Preview,
            storageType: FileStorageType.Local,
            storageKey: previewPdf.storageKey,
            externalUrl: null,
            originalFileName: previewPdf.originalFileName,
            mimeType: previewPdf.mimeType,
            sizeBytes: previewPdf.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-document',
      title: 'نمونه سند کتابخانه و پیوست DOCX',
      summary: 'نمونه محتوا با فایل سند اداری برای بررسی نمایش کارت مشخصات فایل و پیوست‌ها.',
      body: '<p>توضیحات راهنمای سند همراه با فایل پیوست آزمایشی.</p>',
      format: 'Book',
      readWatchMinutes: 25,
      prepareFiles: async () => {
        const docx = await fileStorage.saveAsync({
          bytes: buildMinimalZipOfficeBytes(),
          originalFileName: 'sample-research-paper.docx',
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          visibility: 'private',
          uploadedById: creator.id,
        });
        return [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: docx.storageKey,
            externalUrl: null,
            originalFileName: docx.originalFileName,
            mimeType: docx.mimeType,
            sizeBytes: docx.sizeBytes,
          },
        ];
      },
    },
    {
      slug: 'sample-article',
      title: 'نمونه مقاله پژوهشی در باب روش اندیشه‌ورزی',
      summary: 'مقاله کامل آزمایشی شامل تیترها، نقل‌قول و فهرست برای بررسی خوانایی در سه تم سنی.',
      body: '<h2>مقدمه پژوهش</h2><p>اندیشه‌ورزی نظام‌مند نیازمند مستندسازی دقیق و رجوع به منابع معتبر است. در این مقاله اصول پایه مرور منابع بررسی می‌شود.</p><blockquote>پژوهش استوار بر پایه منابع شفاف و نقدپذیر شکل می‌گیرد.</blockquote><h3>محورهای کلیدی</h3><ul><li>تبیین دقیق مسئله پیش از قضاوت</li><li>مقایسه دیدگاه‌های تاریخی و معاصر</li><li>ارجاع روشن به اسناد و داده‌های معتبر</li></ul>',
      format: 'Article',
      readWatchMinutes: 7,
      prepareFiles: async () => [],
    },
  ];

  let insertedCount = 0;

  for (const spec of sampleSpecs) {
    const existing = await contentRepository.getContentItemBySlug(spec.slug);
    if (existing) {
      continue;
    }

    const thumb = await fileStorage.saveAsync({
      bytes: buildMinimalValidPngBytes(),
      originalFileName: `${spec.slug}-thumb.png`,
      contentType: 'image/png',
      visibility: 'public',
      uploadedById: creator.id,
    });

    const created = await contentRepository.createContentItem({
      title: spec.title,
      slug: spec.slug,
      summary: spec.summary,
      body: spec.body,
      format: spec.format,
      impactLevelId: defaultImpactId,
      status: ContentStatus.Published,
      publishedAt: nowIso,
      readWatchMinutes: spec.readWatchMinutes,
      thumbnailKey: thumb.storageKey,
      isFeatured: false,
      languageCode: 'fa',
      searchText: searchNormalizer.buildSearchText({
        title: spec.title,
        summary: spec.summary,
        bodyHtml: spec.body ?? '',
        sourceTitles: ['مرکز پژوهش‌های معراج اندیشه'],
      }),
      viewCount: 0,
      downloadCount: 0,
      likeCount: 0,
      createdById: creator.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const fileInputs = await spec.prepareFiles();
    if (fileInputs.length > 0) {
      await contentRepository.replaceFiles(
        created.id,
        fileInputs.map((f, idx) => ({
          contentId: created.id,
          kind: f.kind,
          storageType: f.storageType,
          storageKey: f.storageKey,
          externalUrl: f.externalUrl,
          originalFileName: f.originalFileName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          isDownloadable: true,
          sortOrder: idx,
        })),
      );
    }

    await contentRepository.replaceSources(created.id, [
      {
        contentId: created.id,
        title: 'مجموعه اسناد و مطالعات بنیادین معراج اندیشه',
        url: 'https://aparat.com',
        note: 'فصل اول، صفحات ۱۲ تا ۲۸ (نمونه آزمایشی)',
        sortOrder: 0,
      },
    ]);

    if (primaryTopicIds.length > 0) {
      await contentRepository.replaceContentTopics(created.id, primaryTopicIds);
    }
    await contentRepository.replaceContentTags(created.id, [sampleTag.id]);
    await contentRepository.replaceContentPersons(created.id, [samplePerson.id]);

    insertedCount += 1;
  }

  return { insertedCount };
}
