export interface WikimediaImage {
  pageid: number;
  title: string;
  pageUrl: string;
  original: ImageVariant | null;
  thumb: ImageVariant | null;
  categories: string[];
  description?: string;
  license?: string;
  dateCreated?: string;
  museum?: string;
  sourceItem?: string; // Wikidata QID
}

export interface ImageVariant {
  url: string;
  width: number;
  height: number;
  mime: string;
}

export interface DownloadedImage extends ImageVariant {
  buffer: Buffer;
  sha256: string;
  ext: string;
  fileSize: number;
}

export interface MetImage {
  objectID: number;
  title: string;
  pageUrl: string;
  primaryImage: string;
  primaryImageSmall?: string;
  additionalImages?: string[];
  description?: string;
  objectDate?: string;
  medium?: string;
  dimensions?: string;
  department?: string;
  tags?: string[];
  artistDisplayName?: string;
  artistNationality?: string;
  artistBeginDate?: string;
  artistEndDate?: string;
}

