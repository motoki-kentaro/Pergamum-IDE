import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  getPath: vi.fn(() => "C:\\fake-userData")
}));

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: electronMock.getPath
  }
}));

vi.mock("node:fs", () => ({
  promises: fsMock
}));

import {
  loadSettings,
  parseSaveApplicationSettingsRequest,
  saveApplicationSettings
} from "../../src/main/settingsStore";
import type { SaveApplicationSettingsRequest } from "../../src/shared/settings";
import { getCatalogDefaultValue } from "../../src/shared/settingsCatalog";

const languageDefault = getCatalogDefaultValue("workbench.language");
const statusBarVisibleDefault = getCatalogDefaultValue(
  "workbench.statusBar.visible"
);
// #252/#257: editor.lineEnding.* and editor.paragraphIndent.* are
// always-resolved (non-sparse), unlike fontFamily — every save request's
// `editor` must carry them.
const defaultLineEndingSettings = {
  expected: getCatalogDefaultValue("editor.lineEnding.expected"),
  markerGlyph: getCatalogDefaultValue("editor.lineEnding.markerGlyph")
};

const defaultWhitespaceSettings = {
  renderIdeographicSpace: getCatalogDefaultValue(
    "editor.whitespace.renderIdeographicSpace"
  ),
  renderAsciiSpace: getCatalogDefaultValue(
    "editor.whitespace.renderAsciiSpace"
  ),
  renderTab: getCatalogDefaultValue("editor.whitespace.renderTab"),
  renderOtherUnicodeSpace: getCatalogDefaultValue(
    "editor.whitespace.renderOtherUnicodeSpace"
  )
};

const defaultParagraphIndentSettings = {
  excludeLeadingCharacters: getCatalogDefaultValue(
    "editor.paragraphIndent.excludeLeadingCharacters"
  )
};
const defaultCharacterCountSettings = {
  visible: getCatalogDefaultValue("editor.characterCount.visible"),
  exclude: {
    whitespace: getCatalogDefaultValue(
      "editor.characterCount.exclude.whitespace"
    ),
    lineBreaks: getCatalogDefaultValue(
      "editor.characterCount.exclude.lineBreaks"
    ),
    headings: getCatalogDefaultValue(
      "editor.characterCount.exclude.headings"
    ),
    markdownSyntax: getCatalogDefaultValue(
      "editor.characterCount.exclude.markdownSyntax"
    ),
    markdownComments: getCatalogDefaultValue(
      "editor.characterCount.exclude.markdownComments"
    )
  }
};
const defaultUndoHistoryMinDepth = getCatalogDefaultValue(
  "editor.undoHistoryMinDepth"
);
const defaultSelectionHighlightMode = getCatalogDefaultValue(
  "editor.selectionHighlightMode"
);
const defaultFindGutterMarkers = getCatalogDefaultValue(
  "editor.findGutterMarkers"
);
const defaultCaptureTabInEditor = getCatalogDefaultValue(
  "editor.captureTabInEditor"
);
function statusBarSettings(visible: boolean) {
  return { visible };
}
const defaultSoundSettings = {
  enabled: true,
  dialog: { enabled: true },
  newline: { enabled: false },
  keypress: { enabled: false }
};
const recentProject = {
  projectId: "018f4b8c-7a2b-7c3d-8e4f-123456789abc",
  projectName: "proj",
  projectFilePath: "C:\\proj\\proj.pergamum",
  projectRootPath: "C:\\proj",
  schemaVersion: 1,
  lastOpenedAt: "2026-08-23T00:00:00.000Z"
};

function onDiskSettings(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    preview: { renderer: "markdown" },
    recentProjects: [],
    ...overrides
  });
}

function saveRequest(
  workbench: Record<string, unknown>
): SaveApplicationSettingsRequest {
  return {
    preview: {
      renderer: "markdown",
      updateDelayMs: 10000,
      syncScrollEditorToPreview: true,
      syncScrollPreviewToEditor: true,
      doubleClickJumpToEditor: true,
      glossaryAnnotations: false,
      glossaryHighlightOpacity: 0.35
    },
    workbench: {
      sound: defaultSoundSettings,
      ...workbench
    },
    commandPalette: {
      footerDetail: {
        enable: true,
        marquee: { delay: 2000, speed: 40 }
      },
      launchAnimation: {
        durationMs: getCatalogDefaultValue(
          "commandPalette.launchAnimation.durationMs"
        )
      }
    },
    editor: {
      lineEnding: defaultLineEndingSettings,
      whitespace: defaultWhitespaceSettings,
      paragraphIndent: defaultParagraphIndentSettings,
      characterCount: {
        ...defaultCharacterCountSettings,
        exclude: { ...defaultCharacterCountSettings.exclude }
      },
      undoHistoryMinDepth: defaultUndoHistoryMinDepth,
      selectionHighlightMode: defaultSelectionHighlightMode,
      findGutterMarkers: defaultFindGutterMarkers,
      captureTabInEditor: defaultCaptureTabInEditor,
      fencedCodeIndentUnit: "spaces4"
    },
    markdownFiles: {
      lineEnding: "lf", encoding: "utf8"
    },
    textFiles: {
      enablePlainTextDocuments: false,
      lineEnding: "lf",
      encoding: "utf8",
      indentUnit: "tab"
    },
    imageAttachment: { saveDirectory: "" }
  } as unknown as SaveApplicationSettingsRequest;
}

describe("settingsStore workbench.language / workbench.statusBar.visible read path (#174)", () => {
  beforeEach(() => {
    fsMock.readFile.mockReset();
    fsMock.writeFile.mockReset();
    fsMock.mkdir.mockReset();
  });

  it("reads a valid nested workbench.language from settings.json", async () => {
    const settings = await (async () => {
      fsMock.readFile.mockResolvedValue(
        onDiskSettings({ workbench: { language: "en", statusBar: { visible: true } } })
      );
      return loadSettings();
    })();

    expect(settings.workbench.language).toBe("en");
  });

  it("reads a valid nested workbench.statusBar.visible from settings.json", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({
        workbench: { language: "ja", statusBar: { visible: false } }
      })
    );

    const settings = await loadSettings();

    expect(settings.workbench.statusBar.visible).toBe(false);
  });

  it("migrates legacy workbench.statusBar.characterCount.visible to editor.characterCount.visible when editor.characterCount.visible is missing on disk", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({
        workbench: {
          language: "ja",
          statusBar: {
            visible: true,
            characterCount: { visible: false }
          }
        }
      })
    );

    const settings = await loadSettings();

    expect(settings.editor.characterCount.visible).toBe(false);
  });

  it("prioritizes editor.characterCount.visible over legacy workbench.statusBar.characterCount.visible when both are present", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({
        workbench: {
          language: "ja",
          statusBar: {
            visible: true,
            characterCount: { visible: false }
          }
        },
        editor: {
          characterCount: {
            visible: true,
            exclude: defaultCharacterCountSettings.exclude
          }
        }
      })
    );

    const settings = await loadSettings();

    expect(settings.editor.characterCount.visible).toBe(true);
  });
});

describe("settingsStore workbench.language / workbench.statusBar.visible write path (#174)", () => {
  beforeEach(() => {
    fsMock.readFile.mockReset();
    fsMock.writeFile.mockReset();
    fsMock.mkdir.mockReset();
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.mkdir.mockResolvedValue(undefined);
  });

  it("writes a nested workbench.language on save", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({ workbench: { language: "ja", statusBar: { visible: true } } })
    );

    await saveApplicationSettings(
      saveRequest({ language: "en", statusBar: statusBarSettings(true) })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(written.workbench.language).toBe("en");
    expect(written.language).toBeUndefined();
  });

  it("writes a nested workbench.statusBar.visible on save", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({ workbench: { language: "ja", statusBar: { visible: true } } })
    );

    await saveApplicationSettings(
      saveRequest({ language: "ja", statusBar: statusBarSettings(false) })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(written.workbench.statusBar.visible).toBe(false);
    expect(written.showStatusBar).toBeUndefined();
  });

  it("writes editor.characterCount.visible on save and omits workbench.statusBar.characterCount", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({
        workbench: { language: "ja", statusBar: statusBarSettings(true) }
      })
    );

    const req = saveRequest({
      language: "ja",
      statusBar: statusBarSettings(true)
    });
    req.editor.characterCount.visible = false;

    await saveApplicationSettings(req);

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(written.editor.characterCount.visible).toBe(false);
    expect(written.workbench.statusBar.characterCount).toBeUndefined();
  });

  it("does not write a legacy top-level language key", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({ workbench: { language: "ja", statusBar: { visible: true } } })
    );

    await saveApplicationSettings(
      saveRequest({ language: "en", statusBar: statusBarSettings(true) })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(Object.keys(written)).not.toContain("language");
  });

  it("does not write a legacy top-level showStatusBar key", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({ workbench: { language: "ja", statusBar: { visible: true } } })
    );

    await saveApplicationSettings(
      saveRequest({ language: "ja", statusBar: statusBarSettings(false) })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(Object.keys(written)).not.toContain("showStatusBar");
  });

  it("rejects a save request with an invalid workbench.language and never writes settings.json", () => {
    const invalidSaveRequest = saveRequest({
      language: "fr",
      statusBar: statusBarSettings(true)
    });

    expect(() =>
      parseSaveApplicationSettingsRequest(invalidSaveRequest)
    ).toThrow("Invalid application settings.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a save request with an invalid workbench.statusBar.visible and never writes settings.json", () => {
    const invalidSaveRequest = saveRequest({
      language: "ja",
      statusBar: { ...statusBarSettings(true), visible: "yes" }
    });

    expect(() =>
      parseSaveApplicationSettingsRequest(invalidSaveRequest)
    ).toThrow("Invalid application settings.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a save request with an invalid editor.characterCount.visible and never writes settings.json", () => {
    const invalidSaveRequest = saveRequest({
      language: "ja",
      statusBar: statusBarSettings(true)
    });
    (invalidSaveRequest.editor.characterCount as unknown as Record<string, unknown>).visible = "yes";

    expect(() =>
      parseSaveApplicationSettingsRequest(invalidSaveRequest)
    ).toThrow("Invalid application settings.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("given settings.json with a recentProjects entry, preview.renderer, and a valid workbench.fontFamily, saving a change to only workbench.statusBar.visible preserves all three unchanged", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({
        workbench: {
          language: "ja",
          statusBar: { visible: true },
          fontFamily: "Fira Code"
        },
        preview: { renderer: "markdown" },
        recentProjects: [recentProject]
      })
    );

    await saveApplicationSettings(
      saveRequest({
        language: "ja",
        statusBar: statusBarSettings(false),
        fontFamily: "Fira Code"
      })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(written.recentProjects).toEqual([recentProject]);
    expect(written.preview).toEqual({
      renderer: "markdown",
      updateDelayMs: 10000,
      syncScrollEditorToPreview: true,
      syncScrollPreviewToEditor: true,
      doubleClickJumpToEditor: true,
      glossaryAnnotations: false,
      glossaryHighlightOpacity: 0.35
    });
    expect(written.workbench.fontFamily).toBe("Fira Code");
    expect(written.workbench.sound).toEqual(defaultSoundSettings);
    expect(written.workbench.statusBar.visible).toBe(false);
  });

  it("does not introduce unknown-key preservation: an unrecognized top-level key in the save request is rejected, same as before #174 (unknown-key preservation did not exist pre-#174 — see implementation report)", () => {
    const invalidSaveRequest = {
      workbench: {
        language: "ja",
        statusBar: statusBarSettings(true),
        sound: defaultSoundSettings
      },
      commandPalette: {
        footerDetail: {
          enable: true,
          marquee: { delay: 2000, speed: 40 }
        },
        launchAnimation: {
          durationMs: getCatalogDefaultValue(
            "commandPalette.launchAnimation.durationMs"
          )
        }
      },
      editor: {
        lineEnding: defaultLineEndingSettings,
        whitespace: defaultWhitespaceSettings,
        paragraphIndent: defaultParagraphIndentSettings,
        characterCount: defaultCharacterCountSettings,
        undoHistoryMinDepth: defaultUndoHistoryMinDepth,
        selectionHighlightMode: defaultSelectionHighlightMode,
        findGutterMarkers: defaultFindGutterMarkers,
        captureTabInEditor: defaultCaptureTabInEditor,
        fencedCodeIndentUnit: "spaces4"
      },
      markdownFiles: {
        lineEnding: "lf", encoding: "utf8"
      },
      textFiles: {
        enablePlainTextDocuments: false, lineEnding: "lf", encoding: "utf8"
      },
      somethingUnknown: true
    };

    expect(() =>
      parseSaveApplicationSettingsRequest(invalidSaveRequest)
    ).toThrow("Invalid application settings.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("does not introduce unknown-key preservation: an unrecognized key inside workbench is rejected", () => {
    const invalidSaveRequest = {
      workbench: {
        language: "ja",
        statusBar: statusBarSettings(true),
        sound: defaultSoundSettings,
        somethingUnknown: true
      },
      commandPalette: {
        footerDetail: {
          enable: true,
          marquee: { delay: 2000, speed: 40 }
        },
        launchAnimation: {
          durationMs: getCatalogDefaultValue(
            "commandPalette.launchAnimation.durationMs"
          )
        }
      },
      editor: {
        lineEnding: defaultLineEndingSettings,
        whitespace: defaultWhitespaceSettings,
        paragraphIndent: defaultParagraphIndentSettings,
        characterCount: defaultCharacterCountSettings,
        undoHistoryMinDepth: defaultUndoHistoryMinDepth,
        selectionHighlightMode: defaultSelectionHighlightMode,
        findGutterMarkers: defaultFindGutterMarkers,
        captureTabInEditor: defaultCaptureTabInEditor,
        fencedCodeIndentUnit: "spaces4"
      },
      markdownFiles: {
        lineEnding: "lf", encoding: "utf8"
      },
      textFiles: {
        enablePlainTextDocuments: false, lineEnding: "lf", encoding: "utf8"
      }
    };

    expect(() =>
      parseSaveApplicationSettingsRequest(invalidSaveRequest)
    ).toThrow("Invalid application settings.");
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("a save request omitting workbench.fontFamily leaves it missing rather than writing back the catalog default (#173 D-7 preserved by #174)", async () => {
    fsMock.readFile.mockResolvedValue(
      onDiskSettings({ workbench: { language: "ja", statusBar: { visible: true } } })
    );

    await saveApplicationSettings(
      saveRequest({ language: "ja", statusBar: statusBarSettings(false) })
    );

    const [, writtenContent] = fsMock.writeFile.mock.calls[0] as [
      string,
      string
    ];
    const written = JSON.parse(writtenContent);

    expect(written.workbench.fontFamily).toBeUndefined();
    expect(
      JSON.stringify(written).includes(
        getCatalogDefaultValue("workbench.fontFamily")
      )
    ).toBe(false);
  });
});
