/**
 * How a retrieved passage is cited, and how exactly.
 *
 * Two rows carry a reference and they mean different things. `documents` names
 * a physical volume, because a document is one volume of an edition. `chunks`
 * names the printed page the chunker read off the mARkdown page markers. The
 * page is what a reader can actually look up, so it wins wherever it exists.
 *
 * The Qur'an is the case that keeps the fallback honest: its chunk ref is empty
 * because its document ref is already exact — an ayah is cited 2:110, not by
 * volume — so falling through to the document there is right, not a degradation.
 *
 * Every query that renders a citation to a reader must use this, so that the
 * app never shows two different references for the same passage.
 *
 * Requires the query to alias chunks as `c` and documents as `d`.
 */
export const REF_COLUMNS = `
            coalesce(nullif(c.canonical_ref, ''), d.canonical_ref) as canonical_ref,
            -- Chapter-level: the chunker produced a ref for this span but found
            -- no page marker, so it names the work and nothing finer. Surfaced
            -- to the reader rather than hidden; see Source.chapterLevel.
            (c.canonical_ref <> '' and position(':' in c.canonical_ref) = 0)
              as chapter_level`;

/**
 * The passage text to show a reader, and where it really comes from.
 *
 * `documents.arabic_text` is the whole digitised volume and is null for most of
 * this corpus — 1,925 of the 2,082 chunks the answer bank cites hang off a
 * document without it. Reading only that column, the source panel rendered an
 * attribution line and no text at all for 92% of the daleel, in an app whose
 * whole claim is that the reader can go and check.
 *
 * `chunks.content` is never null, and it is the passage that was actually
 * retrieved and cited rather than the volume it sits in — the better thing to
 * show even where both exist. It is stored in the shape the embedder was fed:
 *
 *     <canonical ref> — <breadcrumb>\n\nArabic:\n<the passage>
 *
 * That header is scaffolding, and the reader is already looking at the
 * reference above it, so it is cut here rather than in the component. All
 * 140,379 chunks carry the marker and none carries an English section, so the
 * `else` branch is defensive only.
 *
 * Requires the query to alias chunks as `c` and documents as `d`.
 */
export const PASSAGE_COLUMN = `
            coalesce(
              d.arabic_text,
              case
                when position(E'\\n\\nArabic:\\n' in c.content) > 0
                then substring(c.content from position(E'\\n\\nArabic:\\n' in c.content) + 10)
                else c.content
              end
            ) as arabic_text`;
