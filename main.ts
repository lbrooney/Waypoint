import { App, debounce, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';

// Remember to rename these classes and interfaces!

interface WaypointSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: WaypointSettings = {
	mySetting: 'default'
}

export default class Waypoint extends Plugin {
	static readonly WAYPOINT_FLAG = "%% Waypoint %%";
	static readonly BEGIN_WAYPOINT = "%% Begin Waypoint %%";
	static readonly END_WAYPOINT = "%% End Waypoint %%";

	foldersWithChanges = new Set<TFolder>();
	settings: WaypointSettings;

	async onload() {
		await this.loadSettings();
		this.app.workspace.onLayoutReady(async () => {
			// Register events after layout is built to avoid initial wave of 'create' events
			this.registerEvent(this.app.vault.on("create", (file) => {
				console.log("create " + file.name);
				this.foldersWithChanges.add(file.parent);
				this.scheduleUpdate();
			}));
			this.registerEvent(this.app.vault.on("delete", (file) => {
				console.log("delete " + file.name);
				console.log(file);
				const parentFolder = this.getParentFolder(file.path);
				if (parentFolder !== null) {
					this.foldersWithChanges.add(parentFolder);
					this.scheduleUpdate();
				}
			}));
			this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
				console.log("rename " + file.name);
				console.log(file);
				this.foldersWithChanges.add(file.parent);
				const parentFolder = this.getParentFolder(oldPath);
				if (parentFolder !== null) {
					this.foldersWithChanges.add(parentFolder);
				}
				this.scheduleUpdate();
			}));
			this.registerEvent(this.app.vault.on("modify", this.detectWaypointFlag));
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
	}

	detectWaypointFlag = async (file: TFile) => {
		console.log("Modification on " + file.name);
		console.log("Scanning for Waypoint flags...");
		const text = await this.app.vault.cachedRead(file);
		const lines: string[] = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === (Waypoint.WAYPOINT_FLAG)) {
				console.log("Found waypoint flag!");
				await this.updateWaypoint(file);
				await this.updateParentWaypoint(file.parent, false);
				return;
			}
		}
		console.log("No waypoint flags found.");
	}

	async updateWaypoint(file: TFile) {
		console.log("Updating waypoint in " + file.path);
		const fileTree = await this.getFileTreeRepresentation(file.parent, 0, true);
		const waypoint = `${Waypoint.BEGIN_WAYPOINT}\n${fileTree}\n${Waypoint.END_WAYPOINT}`;
		const text = await this.app.vault.read(file);
		const lines: string[] = text.split("\n");
		let waypointStart = -1;
		let waypointEnd = -1;
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (waypointStart === -1 && (trimmed === (Waypoint.WAYPOINT_FLAG) || trimmed === (Waypoint.BEGIN_WAYPOINT))) {
				waypointStart = i;
			} else if (waypointStart !== -1 && trimmed === (Waypoint.END_WAYPOINT)) {
				waypointEnd = i;
				break;
			}
		}
		if (waypointStart === -1) {
			console.error("Error: No waypoint found while trying to update " + file.path);
			return;
		}
		console.log("Waypoint found at " + waypointStart + " to " + waypointEnd);
		lines.splice(waypointStart, waypointEnd !== -1 ? waypointEnd - waypointStart + 1 : 1, waypoint);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async getFileTreeRepresentation(node: TAbstractFile, indentLevel: number, topLevel = false): Promise<string>|null {
		const bullet = "	".repeat(indentLevel) + "-";
		if (node instanceof TFile) {
			return `${bullet} [[${node.basename}]]`;
		} else if (node instanceof TFolder) {
			if (!topLevel) {
				const folderNote = this.app.vault.getAbstractFileByPath(node.path + "/" + node.name + ".md");
				if (folderNote instanceof TFile) {
					const content = await this.app.vault.cachedRead(folderNote);
					if (content.includes(Waypoint.BEGIN_WAYPOINT) || content.includes(Waypoint.WAYPOINT_FLAG)) {
						return `${bullet} **[[${folderNote.basename}]]**`;
					}
				}
			}
			let text = `${bullet} **${node.name}**`;
			if (node.children && node.children.length > 0) {
				let children = node.children;
				children = children.sort((a, b) => {
					const aName = a.name.toLowerCase();
					const bName = b.name.toLowerCase();
					if (aName < bName) {
						return -1;
					} else if (aName > bName) {
						return 1;
					}
					return 0;
				});
				text += "\n" + (await Promise.all(children.map(child => this.getFileTreeRepresentation(child, indentLevel + 1))))
					.filter(Boolean)
					.join("\n");
				return text;
			} else {
				return `${bullet} **${node.name}**`;
			}

		}
		return null;
	}

	updateChangedFolders = async () => {
		console.log("Updating changed folders...");
		this.foldersWithChanges.forEach((folder) => {
			console.log("Updating " + folder.path);
			this.updateParentWaypoint(folder, true);
		});
		this.foldersWithChanges.clear();
	}

	scheduleUpdate = debounce(
		this.updateChangedFolders.bind(this),
		500,
		true
	);

	updateParentWaypoint = async (node: TAbstractFile, includeCurrentNode: boolean) => {
		const parentWaypoint = await this.locateParentWaypoint(node, includeCurrentNode);
		if (parentWaypoint !== null) {
			this.updateWaypoint(parentWaypoint);
		}
	}

	async locateParentWaypoint(node: TAbstractFile, includeCurrentNode: boolean): Promise<TFile> {
		console.log("Locating parent waypoint of " + node.name);
		let folder = includeCurrentNode ? node : node.parent;
		while (folder) {
			console.log(folder.name);
			const folderNote = this.app.vault.getAbstractFileByPath(folder.path + "/" + folder.name + ".md");
			if (folderNote instanceof TFile) {
				console.log("Found folder note: " + folderNote.path);
				const text = await this.app.vault.cachedRead(folderNote);
				if (text.includes(Waypoint.BEGIN_WAYPOINT) || text.includes(Waypoint.WAYPOINT_FLAG)) {
					console.log("Found parent waypoint!");
					return folderNote;
				}
			}
			folder = folder.parent;
		}
		console.log("No parent waypoint found.");
		return null;
	}

	getParentFolder(path: string): TFolder {
		const abstractFile = this.app.vault.getAbstractFileByPath(path.split("/").slice(0, -1).join("/"));
		if (abstractFile instanceof TFolder) {
			return abstractFile;
		} else {
			return null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: Waypoint;

	constructor(app: App, plugin: Waypoint) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}