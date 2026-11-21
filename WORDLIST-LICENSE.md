# Vietnamese word-list attribution

The bundled `Src/wordlist.js` contains exact two-syllable entries filtered from **Viet74K.txt** in [duyet/vietnamese-wordlist](https://github.com/duyet/vietnamese-wordlist), compiled by Duyet from Vietnamese word-list work associated with Ho Ngoc Duc.

Source: https://raw.githubusercontent.com/duyet/vietnamese-wordlist/master/Viet74K.txt

The source repository identifies its word-list data as **GNU General Public License, version 2.0 (GPL-2.0)**. The filtered list is distributed under the same license. See the [GPL-2.0 text](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html).

One attested example phrase, `con gà`, is included because it appears in the Vietnamese dictionary entry for `con` as a dictionary example: https://home.vndic.net/con-vi_vi.html.

The game accepts only exact two-syllable phrase matches in this bundled list. It does not infer validity by checking the individual syllables separately. The source is not exhaustive; regional, slang, newly coined, and some everyday phrases may still be absent.


## Additional player vocabulary

The additional `Src/wordlist-player.js` dataset is derived from `du_lieu/nguoi_choi.txt` and `du_lieu/tu_cam.txt` in [banhmi-collab/noi-tu-tieng-viet](https://github.com/banhmi-collab/noi-tu-tieng-viet). It is derived from Vietnamese Wiktionary and is licensed **CC BY-SA 4.0**. The bundled player list is normalized and filtered against the source's blocked-word list. The source dataset's license applies to that data file, not to the bot's application code.

Source files:
- https://github.com/banhmi-collab/noi-tu-tieng-viet/blob/master/du_lieu/nguoi_choi.txt
- https://github.com/banhmi-collab/noi-tu-tieng-viet/blob/master/du_lieu/tu_cam.txt
- License: https://creativecommons.org/licenses/by-sa/4.0/

Two manually curated examples `gái tây` and `tây tạng` are included as explicit supplemental entries because they are valid phrases missing from the source lists. The combined game dictionary is the union of the original Viet74K-derived list, this player vocabulary, and the small curated supplement. This improves coverage but is not a claim that every Vietnamese phrase is present.
