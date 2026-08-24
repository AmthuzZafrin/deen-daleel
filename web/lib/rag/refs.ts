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
