# Wikiquote Scraper - Example Outputs

This document shows examples of what the scraper would extract from the Marcus Aurelius Wikiquote page.

## Example 1: Simple Quote (Single Translation)

### Raw HTML (what we'd parse):
```html
<li>Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.
<ul>
  <li>I, 1</li>
</ul>
</li>
```

### Extracted Quote Object:
```json
{
  "text": "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.",
  "reference": "I, 1",
  "book": "I",
  "section": "1",
  "source": "Meditations",
  "translation": null,
  "is_disputed": false
}
```

### Database Record (for `quotes` table):
```json
{
  "text": "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.",
  "author": "Marcus Aurelius",
  "philosopher_id": "<philosopher_uuid>",
  "reference": "I, 1",
  "book": "I",
  "source": "Meditations"
}
```

---

## Example 2: Multiple Translations (Same Reference)

### Raw HTML (what we'd parse):
```html
<!-- First translation -->
<li>Of my grandfather Verus I have learned to be gentle and meek...
<ul>
  <li>I, 1</li>
</ul>
</li>

<!-- Second translation (different wording) -->
<li>From my grandfather Verus I learned gentleness and restraint...
<ul>
  <li>I, 1</li>
</ul>
</li>

<!-- Third translation (marked with translator) -->
<li>My grandfather Verus taught me to be gentle and calm...
<ul>
  <li>I, 1</li>
</ul>
</li>
```

### Extracted Quote Objects (all same reference):
```json
[
  {
    "text": "Of my grandfather Verus I have learned to be gentle and meek...",
    "reference": "I, 1",
    "book": "I",
    "section": "1",
    "source": "Meditations",
    "translation": null,
    "is_disputed": false
  },
  {
    "text": "From my grandfather Verus I learned gentleness and restraint...",
    "reference": "I, 1",
    "book": "I",
    "section": "1",
    "source": "Meditations",
    "translation": null,
    "is_disputed": false
  },
  {
    "text": "My grandfather Verus taught me to be gentle and calm...",
    "reference": "I, 1",
    "book": "I",
    "section": "1",
    "source": "Meditations",
    "translation": null,
    "is_disputed": false
  }
]
```

### After Deduplication (Option A: Keep First):
```json
{
  "text": "Of my grandfather Verus I have learned to be gentle and meek...",
  "reference": "I, 1",
  "book": "I",
  "section": "1",
  "source": "Meditations",
  "translation": null,
  "is_disputed": false
}
```

### After Deduplication (Option B: Keep Longest):
```json
{
  "text": "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.",
  "reference": "I, 1",
  "book": "I",
  "section": "1",
  "source": "Meditations",
  "translation": null,
  "is_disputed": false
}
```

### After Deduplication (Option C: Prefer Named Translations):
```json
{
  "text": "My grandfather Verus taught me to be gentle and calm...",
  "reference": "I, 1",
  "book": "I",
  "section": "1",
  "source": "Meditations",
  "translation": "Hays",
  "is_disputed": false
}
```

---

## Example 3: Quote with Named Translation

### Raw HTML:
```html
<li>Her reverence for the divine, her generosity, her inability not only to do wrong but even to conceive of doing it. And the simple way she lived—not in the least like the rich. (Hays translation)
<ul>
  <li>I, 3</li>
</ul>
</li>
```

### Extracted Quote Object:
```json
{
  "text": "Her reverence for the divine, her generosity, her inability not only to do wrong but even to conceive of doing it. And the simple way she lived—not in the least like the rich.",
  "reference": "I, 3",
  "book": "I",
  "section": "3",
  "source": "Meditations",
  "translation": "Hays",
  "is_disputed": false
}
```

**Note**: The "(Hays translation)" text is extracted and stored separately, then removed from the quote text.

---

## Example 4: Quote with Citations (to be filtered)

### Raw HTML:
```html
<li>You will find rest from vain fancies if you perform every act in life as though it were your last. [1]
<ul>
  <li>II, 5</li>
</ul>
</li>
```

### Extracted Quote Object (after cleaning):
```json
{
  "text": "You will find rest from vain fancies if you perform every act in life as though it were your last.",
  "reference": "II, 5",
  "book": "II",
  "section": "5",
  "source": "Meditations",
  "translation": null,
  "is_disputed": false
}
```

**Note**: The `[1]` citation marker is removed during cleaning.

---

## Example 5: Quote with Greek Text

### Raw HTML:
```html
<li>Ἕωθεν προλέγειν ἑαυτῷ: συντεύξομαι περιέργῳ, ἀχαρίστῳ, ὑβριστῇ, δολερῷ, βασκάνῳ, ἀκοινωνήτῳ: πάντα ταῦτα συμβέβηκεν ἐκείνοις παρὰ τὴν ἄγνοιαν τῶν ἀγαθῶν καὶ κακῶν.
<br>
<strong>When you wake up in the morning, tell yourself: The people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. They are like this because they can't tell good from evil.</strong> (Hays translation)
<ul>
  <li>II, 1</li>
</ul>
</li>
```

### Extracted Quote Object (Option A: Keep English Only):
```json
{
  "text": "When you wake up in the morning, tell yourself: The people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. They are like this because they can't tell good from evil.",
  "reference": "II, 1",
  "book": "II",
  "section": "1",
  "source": "Meditations",
  "translation": "Hays",
  "is_disputed": false,
  "original_text": "Ἕωθεν προλέγειν ἑαυτῷ: συντεύξομαι περιέργῳ, ἀχαρίστῳ, ὑβριστῇ, δολερῷ, βασκάνῳ, ἀκοινωνήτῳ: πάντα ταῦτα συμβέβηκεν ἐκείνοις παρὰ τὴν ἄγνοιαν τῶν ἀγαθῶν καὶ κακῶν."
}
```

### Extracted Quote Object (Option B: Keep Both):
```json
{
  "text": "When you wake up in the morning, tell yourself: The people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. They are like this because they can't tell good from evil.",
  "reference": "II, 1",
  "book": "II",
  "section": "1",
  "source": "Meditations",
  "translation": "Hays",
  "is_disputed": false,
  "original_text": "Ἕωθεν προλέγειν ἑαυτῷ: συντεύξομαι περιέργῳ, ἀχαρίστῳ, ὑβριστῇ, δολερῷ, βασκάνῳ, ἀκοινωνήτῳ: πάντα ταῦτα συμβέβηκεν ἐκείνοις παρὰ τὴν ἄγνοιαν τῶν ἀγαθῶν καὶ κακῶν."
}
```

---

## Example 6: Quote from Different Book

### Raw HTML:
```html
<li>The universe is change; our life is what our thoughts make it.
<ul>
  <li>IV, 3</li>
</ul>
</li>
```

### Extracted Quote Object:
```json
{
  "text": "The universe is change; our life is what our thoughts make it.",
  "reference": "IV, 3",
  "book": "IV",
  "section": "3",
  "source": "Meditations",
  "translation": null,
  "is_disputed": false
}
```

---

## Example 7: JUNK DATA - Should be SKIPPED

### Example A: From "Disputed" Section
```html
<h2>Disputed</h2>
<li>Some quote that might not be authentic...</li>
```
**Action**: ❌ SKIP - Marked as disputed

### Example B: From "Misattributed" Section
```html
<h2>Misattributed</h2>
<li>Some quote incorrectly attributed to Marcus Aurelius...</li>
```
**Action**: ❌ SKIP - Not actually by Marcus Aurelius

### Example C: From "Quotes about Marcus Aurelius"
```html
<h2>Quotes about Marcus Aurelius</h2>
<li>"Marcus Aurelius was a great philosopher" - Some Other Person</li>
```
**Action**: ❌ SKIP - Quote ABOUT him, not BY him

### Example D: Navigation/Category Link
```html
<div class="mw-normal-catlinks">
  <ul>
    <li><a href="/wiki/Category:Philosophers_from_Rome">Philosophers from Rome</a></li>
  </ul>
</div>
```
**Action**: ❌ SKIP - Navigation element, not a quote

### Example E: Citation Reference
```html
<sup>[1]</sup>
```
**Action**: ❌ FILTER OUT - Remove from quote text

---

## Example 8: Complete Sample Output (First 5 Quotes)

After scraping and processing, here's what the first 5 quotes might look like:

```json
[
  {
    "text": "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth.",
    "reference": "I, 1",
    "book": "I",
    "section": "1",
    "source": "Meditations",
    "translation": null
  },
  {
    "text": "Her reverence for the divine, her generosity, her inability not only to do wrong but even to conceive of doing it. And the simple way she lived—not in the least like the rich.",
    "reference": "I, 3",
    "book": "I",
    "section": "3",
    "source": "Meditations",
    "translation": "Hays"
  },
  {
    "text": "From Apollonius, true liberty, and unvariable steadfastness, and not to regard anything at all, though never so little, but right and reason: and always..that it was possible for the same man to be both vehement and remiss: a man not subject to be vexed, and offended with the incapacity of his scholars and auditors in his lectures and expositions.",
    "reference": "I, 5",
    "book": "I",
    "section": "5",
    "source": "Meditations",
    "translation": null
  },
  {
    "text": "Of Fronto, to how much envy and fraud and hypocrisy the state of a tyrannous king is subject unto, and how they who are commonly called [Eupatridas Gk.], i.e. nobly born, are in some sort incapable, or void of natural affection.",
    "reference": "I, 8",
    "book": "I",
    "section": "8",
    "source": "Meditations",
    "translation": null
  },
  {
    "text": "When you wake up in the morning, tell yourself: The people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. They are like this because they can't tell good from evil.",
    "reference": "II, 1",
    "book": "II",
    "section": "1",
    "source": "Meditations",
    "translation": "Hays"
  }
]
```

---

## Example 9: Database Insert Format

For your existing `quotes` table structure:

```typescript
// What would be inserted into database
const quoteRecords = [
  {
    text: "Of my grandfather Verus I have learned to be gentle and meek...",
    author: "Marcus Aurelius",
    philosopher_id: "<uuid_from_philosophers_table>",
    // Optional fields (if you add them):
    reference: "I, 1",
    book: "I",
    source: "Meditations",
    translation: null
  },
  {
    text: "When you wake up in the morning, tell yourself: The people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. They are like this because they can't tell good from evil.",
    author: "Marcus Aurelius",
    philosopher_id: "<uuid_from_philosophers_table>",
    reference: "II, 1",
    book: "II",
    source: "Meditations",
    translation: "Hays"
  }
];
```

---

## Example 10: Mastodon Post Format

Based on your existing `formatQuote` function in `post-art/index.ts`:

```typescript
function formatQuote(quote: { text: string; author: string }): string {
  return `"${quote.text}"\n\n— ${quote.author}\n\n#philosophy`;
}
```

### Example Mastodon Post:
```
"Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion... I have learned both shamefastness and manlike behaviour. Of my mother I have learned to be religious, and bountiful; and to forbear, not only to do, but to intend any evil; to content myself with a spare diet, and to fly all such excess as is incidental to great wealth."

— Marcus Aurelius

#philosophy
```

---

## Summary of Data Transformations

1. **Raw HTML** → Parse with Cheerio
2. **Extract quote text** → Clean (remove citations, normalize whitespace)
3. **Extract reference** → Parse "I, 1" into book="I", section="1"
4. **Extract translation** → Parse "(Hays translation)" → translation="Hays"
5. **Deduplicate** → Group by reference, keep best translation
6. **Filter junk** → Skip disputed/misattributed sections
7. **Store** → Insert into `quotes` table with `philosopher_id`

---

## Questions to Decide Before Implementation

1. **Deduplication Strategy**: 
   - Keep first translation?
   - Keep longest translation?
   - Prefer named translations (Hays, etc.)?

2. **Greek/Original Text**:
   - Keep only English translations?
   - Store original text separately?
   - Include both in quote text?

3. **Translation Names**:
   - Store translator name in separate field?
   - Include in quote text?
   - Use for deduplication priority?

4. **Database Schema**:
   - Add `reference`, `book`, `source`, `translation` fields?
   - Or just store in `text` field?

Let me know your preferences and I'll implement the scraper accordingly!

