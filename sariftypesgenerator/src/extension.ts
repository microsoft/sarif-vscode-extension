// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { JSONSchema4 } from "json-schema";
import {
    commands, ExtensionContext, OpenDialogOptions, TextDocument, TextEditor, Uri, ViewColumn, window, workspace,
} from "vscode";
import { Parser } from "./parser";
import { Writer } from "./writer";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand("extension.sarifTypes.Generate", generate),
    );
}

/**
 * Function that gets called when the user performs the Generate command
 * It shows an open file dialog, then opens, reads and parses the file selected
 * It then creates and opens a new file that it writes the parsed date out in Typescript format
 * Lastly it calls on vscode's format document to properly align the code
 */
export function generate() {
    const dialogOptions = { canSelectFiles: true, canSelectMany: false, filters: {} } as OpenDialogOptions;
    dialogOptions.filters[`Sarif Schema`] = ["json"];

    window.showOpenDialog(dialogOptions).then((uris: Uri[]) => {
        if (uris !== undefined && uris.length > 0) {
            return workspace.openTextDocument(uris[0]);
        }
    }).then((doc: TextDocument) => {
        if (doc !== undefined) {
            const schema = JSON.parse(doc.getText()) as JSONSchema4;

            const classes = Parser.parseJSONDefinition(schema);

            const output = Writer.outputTypeScript(classes);

            return workspace.openTextDocument({ language: "typescript", content: output });
        }
    }).then((doc: TextDocument) => {
        if (doc !== undefined) {
            return window.showTextDocument(doc, ViewColumn.One, true);
        }
    }).then((textEditor: TextEditor) => {
        commands.executeCommand("editor.action.formatDocument");
    });
}
