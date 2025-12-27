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

export interface NGAArtwork {
  objectid: string;
  title: string;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  displaydate?: string;
  medium?: string;
  dimensions?: string;
  classification?: string;
  culture?: string;
  period?: string;
  creditline?: string;
  dated?: string;
  wikidataQID?: string;
}


