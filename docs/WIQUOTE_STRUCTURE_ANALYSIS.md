# Wikiquote Structure Analysis: Marcus Aurelius

## Overview

Based on the [Marcus Aurelius Wikiquote page](https://en.wikiquote.org/wiki/Marcus_Aurelius), here's a detailed breakdown of how quotes are structured and the challenges you'll face when scraping.

## Page Structure Hierarchy

### 1. **Main Sections** (Top Level)

The page is organized into these major sections:

```
- Quotes (main content)
- Disputed
- Misattributed  
- Quotes about Marcus Aurelius
- External links
```

**⚠️ IMPORTANT**: You'll want to **ONLY scrape from the "Quotes" section** and **SKIP** the other sections to avoid junk data.

### 2. **Quotes Section Structure**

Within the "Quotes" section, content is organized by **source work**:

#### Primary Source: **Meditations** (c. AD 121–180)

The Meditations quotes are further subdivided by **Book**:

- **Book I** - Contains quotes with references like "I, 1", "I, 3", "I, 5", etc.
- **Book II** - Contains quotes with references like "II, 1", etc.
- **Book III** through **Book XII** - Same pattern

### 3. **Individual Quote Structure**

Each quote entry typically follows this pattern:

```
[Quote Text]
* [Reference notation, e.g., "I, 1" or "II, 1"]
```

**Example from the page:**
```
Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.
* I, 1
```

### 4. **Multiple Translations Problem**

**⚠️ MAJOR CHALLENGE**: Many quotes appear **multiple times** with different translations:

```
[Quote Text - Translation 1]
* I, 1

[Quote Text - Translation 2 (different wording)]
* I, 1

[Quote Text - Translation 3 (Hays translation)]
* I, 1
```

**Example from the page:**
```
Of my grandfather Verus I have learned to be gentle and meek...
* I, 1

Her reverence for the divine, her generosity, her inability not only to do wrong but even to conceive of doing it. And the simple way she lived—not in the least like the rich. (Hays translation)
* I, 3
```

**Solution**: You'll need to either:
- **Deduplicate** by reference (e.g., "I, 1") and pick one translation
- **Store all translations** but mark them as variants of the same quote
- **Prefer specific translations** (e.g., "Hays translation") if marked

### 5. **HTML Structure (Inferred)**

Based on MediaWiki structure, quotes are likely organized as:

```html
<h2>Quotes</h2>
  <h3>Meditations (c. AD 121–180)</h3>
    <h4>Book I</h4>
      <ul>
        <li>[Quote text]
          <ul>
            <li>I, 1</li>
          </ul>
        </li>
        <li>[Another quote]
          <ul>
            <li>I, 3</li>
          </ul>
        </li>
      </ul>
    <h4>Book II</h4>
      ...
```

### 6. **Data Quality Issues to Watch For**

#### **Junk Data Sources:**

1. **Disputed Section**: Quotes with uncertain authenticity
   - ❌ **SKIP** - These are marked as disputed for a reason

2. **Misattributed Section**: Quotes incorrectly attributed to Marcus Aurelius
   - ❌ **SKIP** - These are not actually his quotes

3. **Quotes About Marcus Aurelius**: What others said about him
   - ❌ **SKIP** - These are not quotes BY him

4. **Navigation Elements**: Category links, language links, etc.
   - ❌ **SKIP** - Not actual quote content

5. **Metadata/References**: Citation numbers like `[1]`, `[2]`
   - ⚠️ **FILTER OUT** - These are footnotes, not quote content

6. **Greek Text**: Some quotes include original Greek text
   - ⚠️ **DECIDE** - Keep or filter based on your needs

#### **Clean Quote Indicators:**

✅ **Good quote structure:**
- Has reference notation (e.g., "I, 1", "II, 1")
- Is within the "Quotes" → "Meditations" → "Book X" hierarchy
- Contains actual quote text (not just metadata)
- Is not in "Disputed" or "Misattributed" sections

### 7. **Reference Notation Pattern**

Quotes from Meditations use this pattern:
- **Format**: `[Roman Numeral], [Number]`
- **Examples**: `I, 1`, `I, 3`, `II, 1`, `XII, 1`
- **Meaning**: Book number, then section/passage number

**Use this for deduplication**: Multiple translations of the same quote share the same reference.

### 8. **Other Quote Sources**

The page may also contain quotes from:
- **Epistle of Marcus Aurelius to the Senate...**
- **Bartlett's Familiar Quotations** (10th ed. 1919)

These follow similar patterns but may have different reference formats.

## Recommended Scraping Strategy

### Step 1: Identify the "Quotes" Section
- Look for `<h2>Quotes</h2>` or similar heading
- Stop before "Disputed", "Misattributed", or "Quotes about" sections

### Step 2: Focus on Meditations
- Navigate to "Meditations (c. AD 121–180)" subsection
- Process each Book (I through XII)

### Step 3: Extract Quote + Reference Pairs
- For each quote, extract:
  - **Text**: The actual quote text
  - **Reference**: The notation (e.g., "I, 1")
  - **Book**: Which book it's from (I, II, III, etc.)
  - **Translation**: If marked (e.g., "Hays translation")

### Step 4: Deduplication
- Group quotes by reference notation
- If multiple translations exist for same reference:
  - Option A: Pick the first/longest/best translation
  - Option B: Store all but mark as variants
  - Option C: Prefer translations marked with translator name

### Step 5: Filter Out Junk
- Remove citations/references (`[1]`, `[2]`, etc.)
- Skip quotes in "Disputed" and "Misattributed" sections
- Skip "Quotes about Marcus Aurelius" section
- Filter out navigation elements, category links, etc.

## Database Schema Considerations

Based on your existing `quotes` table structure:
- `id` - Unique identifier
- `text` - Quote text (cleaned)
- `author` - "Marcus Aurelius" (or philosopher name)
- `philosopher_id` - Link to philosophers table
- `posted_at` - For tracking posts

**Consider adding:**
- `reference` - Store the reference notation (e.g., "I, 1")
- `book` - Store the book number (I, II, III, etc.)
- `source` - "Meditations" or other source
- `translation` - Translator name if specified
- `is_disputed` - Boolean flag (should be false for clean quotes)

## Example Clean Quote Extraction

**Input (from page):**
```
Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.
* I, 1
```

**Extracted Data:**
```json
{
  "text": "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.",
  "reference": "I, 1",
  "book": "I",
  "source": "Meditations",
  "author": "Marcus Aurelius"
}
```

## Next Steps

1. **Test HTML Parsing**: Fetch the page and examine the actual HTML structure
2. **Build Selectors**: Create CSS selectors or XPath to target quote content
3. **Implement Filters**: Add logic to skip disputed/misattributed sections
4. **Handle Duplicates**: Implement deduplication by reference notation
5. **Clean Text**: Remove citations, normalize whitespace, handle special characters

Would you like me to help implement a scraper following this analysis?

