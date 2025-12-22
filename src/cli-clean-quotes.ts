/**
 * CLI script to remove non-English text from quotes
 * Keeps only the English portion of quotes
 */

import { supabase } from './supabaseClient';

// Common German words and patterns to identify German text
const GERMAN_PATTERNS = [
  /\b(der|die|das|und|ist|sind|war|waren|wird|werden|haben|hat|hätte|kann|können|muss|müssen|soll|sollen|dass|daß|für|von|mit|auf|über|unter|durch|zwischen|bei|nach|vor|seit|während|gegen|ohne|um|bis|zu|aus|in|an|am|zum|zur|zur|dem|den|des|ein|eine|einer|eines|einen|einem|eins|ich|du|er|sie|es|wir|ihr|sie|mich|dich|sich|uns|euch|mein|dein|sein|ihr|unser|euer|meine|deine|seine|ihre|unser|euer|meinen|deinen|seinen|ihren|unseren|euren|meinem|deinem|seinem|ihrem|unserem|eurem|meines|deines|seines|ihres|unseres|eures|mir|dir|ihm|ihr|uns|euch|ihnen|mich|dich|ihn|sie|es|uns|euch|sie)\b/gi,
  /\b(aber|oder|auch|noch|nur|schon|noch|immer|nie|nicht|kein|keine|keinen|keinem|keiner|keines|nichts|niemand|niemandem|niemanden|niemandes|viel|viele|vielen|vieler|vieles|wenig|wenige|wenigen|weniger|weniges|mehr|mehrere|mehreren|mehrerer|mehreres|alle|allen|aller|alles|jeder|jede|jedes|jeden|jedem|jeder|manche|manchen|mancher|manches|einige|einigen|einiger|einiges|viele|vielen|vieler|vieles|beide|beiden|beider|beides|sowohl|als|auch|weder|noch|entweder|oder|ob|obwohl|wenn|falls|weil|da|denn|damit|dass|dass|ob|obwohl|während|bevor|nachdem|seit|bis|sobald|solange|sooft|wie|als|wie|wenn|falls|ob|obwohl|während|bevor|nachdem|seit|bis|sobald|solange|sooft)\b/gi,
];

// Common patterns for mixed-language quotes
// Pattern 1: "German text. English text" or "German text English text"
// Pattern 2: Quotes that start with German and have English after
function extractEnglishText(text: string): string {
  let cleaned = text.trim();
  
  // Remove HTML entities and clean up
  cleaned = cleaned.replace(/&#160;/g, ' ');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  
  // Check if text contains German characters/words
  const hasGermanChars = /[äöüÄÖÜß]/.test(cleaned);
  const hasGermanWords = GERMAN_PATTERNS.some(pattern => pattern.test(cleaned));
  
  if (!hasGermanChars && !hasGermanWords) {
    // No German detected, assume it's already English
    // But check if it's just metadata (like "Beyond Good and Evil , Aphorism 146")
    if (/^(Beyond|Chapter|Aphorism|Letter|Preface|Attempt|p\.|Philipp|Stuttgart)/i.test(cleaned) && cleaned.length < 100) {
      // Likely metadata, skip it
      return cleaned; // Keep for now, but could be filtered out
    }
    return cleaned;
  }
  
  // Pattern 1: "German text. English text" (period separator) - prefer English
  const periodPattern = /^[^.]*[äöüÄÖÜß][^.]*\.\s+([A-Z][^äöüÄÖÜß]{30,})/;
  let match = cleaned.match(periodPattern);
  if (match && match[1]) {
    const englishPart = match[1].trim();
    // Make sure it doesn't start with German words
    if (!GERMAN_PATTERNS.some(pattern => pattern.test(englishPart.substring(0, 50)))) {
      return englishPart;
    }
  }
  
  // Pattern 1b: "German text. English text" - look for English after any period
  const allPeriodMatches = cleaned.matchAll(/[^.]*[äöüÄÖÜß][^.]*\.\s+([A-Z][^äöüÄÖÜß]{30,})/g);
  for (const m of allPeriodMatches) {
    if (m[1]) {
      const candidate = m[1].trim();
      if (!/[äöüÄÖÜß]/.test(candidate) && !GERMAN_PATTERNS.some(pattern => pattern.test(candidate.substring(0, 50)))) {
        return candidate;
      }
    }
  }
  
  // Pattern 2: "German text English text" (no separator, English starts with capital after German)
  const noSeparatorPattern = /^[^A-Z]*[äöüÄÖÜß][^A-Z]*([A-Z][^äöüÄÖÜß]{30,})/;
  match = cleaned.match(noSeparatorPattern);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!/[äöüÄÖÜß]/.test(candidate) && !GERMAN_PATTERNS.some(pattern => pattern.test(candidate.substring(0, 50)))) {
      return candidate;
    }
  }
  
  // Pattern 3: "German text Is not life..." (English starts after German, look for common English starters)
  const englishStarters = /(Is not|Is|Are|Was|Were|Have|Has|Had|Do|Does|Did|Can|Could|Will|Would|Should|May|Might|Must|The|A|An|I|You|We|They|He|She|It|This|That|What|When|Where|Why|How|Free|That|This|What|Which|Who|Whose|Whom|Plato|Alternate)/i;
  const englishAfterGerman = new RegExp(`^[^A-Z]*[äöüÄÖÜß][^A-Z]*(${englishStarters.source}[^äöüÄÖÜß]{20,})`, 'i');
  match = cleaned.match(englishAfterGerman);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!/[äöüÄÖÜß]/.test(candidate)) {
      return candidate;
    }
  }
  
  // Pattern 3b: Look for "German. English" where English comes after German
  const germanThenEnglish = /[äöüÄÖÜß][^.]*\.\s+([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){5,})/;
  match = cleaned.match(germanThenEnglish);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!/[äöüÄÖÜß]/.test(candidate) && candidate.length >= 30) {
      return candidate;
    }
  }
  
  // Pattern 4: Split by sentences and find English-only sentences
  const sentences = cleaned.split(/([.!?]+\s+)/);
  const englishSentences: string[] = [];
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i]?.trim();
    if (!sentence || sentence.length < 20) continue;
    
    // Check if sentence has German
    const hasGerman = /[äöüÄÖÜß]/.test(sentence) || GERMAN_PATTERNS.some(pattern => pattern.test(sentence));
    
    if (!hasGerman) {
      // No German - check if it looks like English
      const looksLikeEnglish = /^[A-Z][a-zA-Z\s,'"\-:;()]+$/.test(sentence) && 
                               !/^(Beyond|Chapter|Aphorism|Letter|Preface|Attempt|p\.|Philipp|Stuttgart)/i.test(sentence);
      if (looksLikeEnglish) {
        englishSentences.push(sentence);
      }
    }
  }
  
  if (englishSentences.length > 0) {
    return englishSentences.join(' ').trim();
  }
  
  // Pattern 5: Look for "English text" pattern after German (common in Wikiquotes)
  // Format: "German text. English text" where English might be in quotes or parentheses
  const quotedEnglish = /[äöüÄÖÜß][^"]*"([^"]{30,})"/;
  match = cleaned.match(quotedEnglish);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // If we can't extract English and it's all German, return empty to mark for deletion
  if (hasGermanChars || hasGermanWords) {
    // Check if there's any substantial English text (at least 30 chars without German)
    const englishParts = cleaned.split(/[.!?]\s+/).filter(s => {
      const trimmed = s.trim();
      if (trimmed.length < 30) return false;
      const hasGerman = /[äöüÄÖÜß]/.test(trimmed) || GERMAN_PATTERNS.some(pattern => pattern.test(trimmed));
      return !hasGerman;
    });
    
    if (englishParts.length === 0) {
      // No English found - mark for deletion
      return '';
    }
    
    // If we found English parts, return them
    if (englishParts.length > 0) {
      return englishParts.join('. ').trim();
    }
  }
  
  return cleaned;
}

async function main() {
  console.log('=== Cleaning Quotes (Removing Non-English Text) ===\n');

  // Fetch all quotes with pagination
  const allQuotes: Array<{ id: string; text: string; philosopher_id: string }> = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: quotes, error: fetchError } = await supabase
      .from('quotes')
      .select('id, text, philosopher_id')
      .order('id')
      .range(from, from + pageSize - 1);

    if (fetchError) {
      console.error('Error fetching quotes:', fetchError);
      process.exit(1);
    }

    if (!quotes || quotes.length === 0) {
      hasMore = false;
    } else {
      allQuotes.push(...quotes);
      from += pageSize;
      hasMore = quotes.length === pageSize;
      console.log(`Fetched ${allQuotes.length} quotes so far...`);
    }
  }

  if (allQuotes.length === 0) {
    console.log('No quotes found.');
    return;
  }

  console.log(`\nFound ${allQuotes.length} total quotes.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  const BATCH_SIZE = 50;

  for (let i = 0; i < allQuotes.length; i += BATCH_SIZE) {
    const batch = allQuotes.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allQuotes.length / BATCH_SIZE)}...`);

    for (const quote of batch) {
      try {
        const cleaned = extractEnglishText(quote.text);
        
        // If cleaned is empty, it means it was all non-English - delete it
        if (cleaned === '' || cleaned.length < 10) {
          // All non-English or too short - delete the quote
          const { error: deleteError } = await supabase
            .from('quotes')
            .delete()
            .eq('id', quote.id);
          
          if (deleteError) {
            console.error(`  ✗ Error deleting non-English quote:`, deleteError.message);
            errors++;
          } else {
            if (updated < 10 || updated % 50 === 0) {
              console.log(`  🗑️  Deleted non-English quote: "${quote.text.substring(0, 60)}${quote.text.length > 60 ? '...' : ''}"`);
            }
            updated++; // Count deletions as updates
          }
          continue;
        }
        
        // Only update if cleaned text is different and meaningful
        if (cleaned !== quote.text && cleaned.length >= 10) {
          // Update character count
          const newCharacterCount = cleaned.length;
          
          const { error: updateError } = await supabase
            .from('quotes')
            .update({ 
              text: cleaned,
              character_count: newCharacterCount
            })
            .eq('id', quote.id);

          if (updateError) {
            console.error(`  ✗ Error updating quote:`, updateError.message);
            errors++;
          } else {
            if (updated < 10 || updated % 50 === 0) {
              console.log(`  ✓ "${quote.text.substring(0, 60)}${quote.text.length > 60 ? '...' : ''}"`);
              console.log(`    → "${cleaned.substring(0, 60)}${cleaned.length > 60 ? '...' : ''}"`);
            }
            updated++;
          }
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗ Error processing quote:`, (err as Error).message);
        errors++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated/Deleted: ${updated}`);
  console.log(`Skipped (already clean): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
