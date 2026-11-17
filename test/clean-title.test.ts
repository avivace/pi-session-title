import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTitle } from "../extensions/session-title.ts";

test("strips quotes, prefixes and trailing punctuation", () => {
	assert.equal(cleanTitle('"Fix license scan CI."'), "Fix license scan CI");
	assert.equal(cleanTitle("Title: maintenance: notes, dotfiles"), "maintenance: notes, dotfiles");
});

test("takes the first non-empty line and caps words", () => {
	assert.equal(cleanTitle("\n\none two three four five six seven eight\nignored"), "one two three four five six");
});

test("returns undefined for empty output", () => {
	assert.equal(cleanTitle("   \n "), undefined);
});
