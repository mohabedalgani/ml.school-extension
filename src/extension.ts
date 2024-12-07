import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import MarkdownIt from "markdown-it";

let terminals: { terminal: vscode.Terminal; idle: boolean }[] = [];
let markdownPanel: vscode.WebviewPanel | undefined;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	// Register the webview view provider so the webview is displayed when the view is clicked
	const provider = new MLSchoolWebviewProvider(extensionContext);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("mlschoolWebview", provider)
	);
}

class MLSchoolWebviewProvider implements vscode.WebviewViewProvider {
	constructor(private context: vscode.ExtensionContext) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		webviewView.webview.options = {
			enableScripts: true,
		};

		// Set the HTML content for the webview
		webviewView.webview.html = getWebviewContent(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage((message) => {
			// The webview will send us a message with an object containing the type of action
			// that the user wants to perform. We can then call the respective function to
			// perform the action.
			switch (message.type) {
				case "onTableOfContentItemClick":
					// Open the file and markdown file in the editor
					onTableOfContentItemClick(message.file, message.markdown);
					break;
				case "runCommandInTerminal":
					// Run the command in a new terminal
					runCommandInTerminal(message.command, message.terminalName);
					break;
				case "openUrlInBrowser":
					// Open the URL in the default browser
					openUrlInBrowser(message.url);
					break;
			}
		});
	}
}

async function onTableOfContentItemClick(file: string, markdown: string) {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("No workspace folder is open.");
		return;
	}

	// Resolve the file paths relative to the workspace root
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	let fileUri: vscode.Uri | null = null;
	let markdownUri: vscode.Uri | null = null;

	if (file) {
		fileUri = vscode.Uri.file(path.join(workspaceRoot, file)); 
		try {
			if (fileUri.fsPath.endsWith('.ipynb')) {
				await vscode.commands.executeCommand('vscode.openWith', fileUri, 'jupyter-notebook', vscode.ViewColumn.One);
			} else {
				const fileDocument = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(fileDocument, vscode.ViewColumn.One);
			}
		}
		catch (error) {
			vscode.window.showErrorMessage(
				`Error opening file: ${(error as Error).message}`
			);	
		}
	}

	if (markdown) {
		markdownUri = vscode.Uri.file(path.join(workspaceRoot, markdown));
		try {
			const markdownContent = fs.readFileSync(markdownUri.fsPath, "utf-8");

			// If a file was provided, we want to reveal the markdown panel beside it,
			// otherwise we'll reveal it in the active column.
			let viewColumn = file ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;

			if (markdownPanel) {
				markdownPanel.webview.html = markdownToHtml(markdownContent, markdownPanel.webview);
				markdownPanel.reveal(viewColumn);
			} else {
				markdownPanel = vscode.window.createWebviewPanel(
					"markdownPreview",
					"Building Machine Learning Systems",
					viewColumn,
					{
						enableScripts: true,
						localResourceRoots: [
							vscode.Uri.joinPath(
								extensionContext.extensionUri,
								"src",
								"html"
							),
							vscode.workspace.workspaceFolders?.[0]?.uri ||
								vscode.Uri.file(""),
						],
					}
				);
	
				markdownPanel.onDidDispose(() => {
					markdownPanel = undefined;
				});

				markdownPanel.webview.html = markdownToHtml(markdownContent, markdownPanel.webview);
			}
		}
		catch (error) {
			vscode.window.showErrorMessage(
				`Error opening markdown file: ${(error as Error).message}`
			);
		}
	}
}

async function runCommandInTerminal(command: string, terminalName: string) {
	let terminalIndex = terminals.findIndex((t) => t.terminal.name === terminalName);

	/**
	 * If we found the terminal in our list but it doesn't exist in the IDE, we need to
	 * remove it from the list.
	 **/
	if (
		terminalIndex !== -1 &&
		!vscode.window.terminals.some((t) => t.name === terminalName)
	) {
		terminals.splice(terminalIndex, 1);
	}

	// If we didn't find the terminal in our list, we can create a new terminal.
	if (terminalIndex === -1) {
		const terminal = createTerminal(terminalName);
		terminals.push({ terminal, idle: true });
		terminalIndex = terminals.length - 1;
	}

	// We will only run the command if the terminal is idle.
	if (terminals[terminalIndex].idle) {
		terminals[terminalIndex].idle = false;
		const terminal = terminals[terminalIndex].terminal;
		terminal.show();
		terminal.sendText(command);
	} else {
		console.log("Command is already running. Please wait.");
	}
}

async function openUrlInBrowser(url: string) {
	vscode.env.openExternal(vscode.Uri.parse(url));
}

function markdownToHtml(markdown: string, webview: vscode.Webview): string {
	const md = new MarkdownIt({
		html: true, // Enable HTML tags in source
		breaks: true,
		linkify: true,
	});

	// Define a custom rule to resolve image paths
	md.renderer.rules.image = (tokens, idx, options, env, self) => {
		const token = tokens[idx];
		let src = token.attrGet("src");

		if (src) {
			// Convert relative paths to full URIs
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (workspaceFolder) {
				const fileUri = vscode.Uri.file(
					path.join(workspaceFolder.uri.fsPath, src)
				);
				const webviewUri = webview.asWebviewUri(fileUri);
				token.attrSet("src", webviewUri.toString()); // Replace src with the webview URI
			}
		}

		// Render the modified token
		return self.renderToken(tokens, idx, options);
	};

	let htmlContent = md.render(markdown);

	const templatePath = vscode.Uri.joinPath(
		extensionContext.extensionUri,
		"src",
		"html",
		"markdown.html"
	);
	let template = fs.readFileSync(templatePath.fsPath, "utf8");
	return template.replace("${content}", htmlContent);
}

function createTerminal(terminalName: string) {
	let newTerminal = vscode.window.createTerminal(terminalName);

	vscode.window.onDidChangeTerminalShellIntegration(
		async ({ terminal, shellIntegration }) => {
			if (terminal === newTerminal) {
				vscode.window.onDidEndTerminalShellExecution((event) => {
					/**
					 * Let's find the terminal that just ended the shell execution and mark it as idle
					 * so it can be reused later.
					 **/
					if (event.terminal === newTerminal) {
						const terminalIndex = terminals.findIndex(
							(t) => t.terminal === newTerminal
						);
						if (terminalIndex !== -1) {
							terminals[terminalIndex].idle = true;
						}

						console.log(`Command exited with code ${event.exitCode}`);
					}
				});
			}
		}
	);

	vscode.window.onDidCloseTerminal((closedTerminal) => {
		// If the terminal is closed, remove it from the list of terminals.
		const index = terminals.findIndex((t) => t.terminal === closedTerminal);
		if (index !== -1) {
			terminals.splice(index, 1);
		}
	});

	return newTerminal;
}

// Generates the HTML content for the webview
function getWebviewContent(webview: vscode.Webview): string {
	// Load the Table of Contents (TOC) data from the workspace
	const tocData = getTOCData();

	// If there is no TOC data, return a message to display in the webview
	if (!tocData || tocData.length === 0) {
		return `<h3>No Table of Contents available.</h3>`;
	}

	let itemIndex = 1;
	const guide = tocData.flatMap((item, index) => {
		const sessionItem = {
			...item,
			type: "session",
			index: index + 1,
			itemIndex: itemIndex++,
		};
		const lessonItems = (item.lessons || []).map(
			(lesson: any, lessonIndex: number) => ({
				...lesson,
				type: "lesson",
				index: lessonIndex + 1,
				sessionIndex: sessionItem.index,
				sessionLabel: sessionItem.label,
				itemIndex: itemIndex++,
			})
		);
		return [sessionItem, ...lessonItems];
	});

	// Step 2: Generate HTML by going through the flattened list once
	const tocHTML = guide
		.map((item) => {
			const header =
				item.type === "lesson"
					? `<h3>Session ${item.sessionIndex} - ${item.sessionLabel}</h3>`
					: `<h3>Session ${item.index}</h3>`;

			const actions = item.actions
				? item.actions
						.map(
							(action: {
								command: any;
								terminal: any;
								label: any;
								url: any;
							}) => {
								if (action.command) {
									const terminal = action.terminal || "mlschool";
									return `<div class="button" onclick="event.stopPropagation(); runCommandInTerminal('${action.command}', '${terminal}')">${action.label}</div>`;
								} else if (action.url) {
									return `<div class="button" onclick="event.stopPropagation(); openUrlInBrowser('${action.url}')">${action.label}</div>`;
								} else {
									return `<div class="button">-</div>`;
								}
							}
						)
						.join("")
				: "";

			let file = item.file || "";
			let markdown = item.markdown || "";

			return `
            <div class="item ${item.type}" onclick="toggleVisibility('${
				item.itemIndex
			}'); onTableOfContentItemClick('${file}', '${markdown}')">
                ${header}
                <h2 class='${item.type}'>
                    ${
						item.type === "lesson"
							? `${item.sessionIndex}.${item.index}. ${item.label}`
							: item.label
					}
                </h2>
    
                <!-- Container holding both description and button, hidden by default -->
                <div id="container-${
					item.itemIndex
				}" class="toc-container" style="display: none;">
                    <div class="description">${item.description || ""}</div>
					${actions}
                </div>
            </div>
            `;
		})
		.join("");

	// Read the HTML template
	const templatePath = path.join(
		extensionContext.extensionPath,
		"src",
		"html",
		"toc.html"
	);
	let template = fs.readFileSync(templatePath, "utf-8");

	// Replace the placeholder with the actual TOC HTML
	return template.replace("${tocHTML}", tocHTML);
}

// Load Table of Contents data from the file
function getTOCData(): any[] {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	// Check if there is an open workspace
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("No workspace folder is open.");
		return [];
	}

	// Construct the path to mlschool-toc.json in the workspace root
	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const tocPath = path.join(workspaceRoot, ".guide", "toc.json");

	// Check if the file exists and load it
	if (fs.existsSync(tocPath)) {
		try {
			const content = fs.readFileSync(tocPath, "utf-8");
			return JSON.parse(content); // Return the parsed TOC data
		} catch (error) {
			vscode.window.showErrorMessage("Error parsing toc.json.");
			return [];
		}
	} else {
		vscode.window.showErrorMessage("mlschool-toc.json not found in the workspace.");
		return [];
	}
}
