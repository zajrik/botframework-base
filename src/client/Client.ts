/* eslint-disable no-await-in-loop */
// /* eslint-disable indent */
import 'reflect-metadata';
import * as Discord from 'discord.js';
import * as Path from 'path';

// eslint-disable-next-line no-duplicate-imports
import {
	ClientEvents,
	ClientOptions,
	ClientApplication,
	Guild,
	Message,
	User,
	PermissionResolvable
} from 'discord.js';

import { Logger, logger } from '../util/logger/Logger';
import { BaseCommandName } from '../types/BaseCommandName';
import { ClientStorage } from '../storage/ClientStorage';
import { Command } from '../command/Command';
import { CommandDispatcher } from '../command/CommandDispatcher';
import { CommandLoader } from '../command/CommandLoader';
import { CommandRegistry } from '../command/CommandRegistry';
import { CompactModeHelper } from '../command/CompactModeHelper';
import { EventLoader } from '../event/EventLoader';
import { GuildStorage } from '../storage/GuildStorage';
import { GuildStorageLoader } from '../storage/GuildStorageLoader';
import { JSONProvider } from '../storage/JSONProvider';
import { Lang } from '../localization/Lang';
import { ListenerUtil } from '../util/ListenerUtil';
import { MiddlewareFunction } from '../types/MiddlewareFunction';
import { PluginConstructor } from '../types/PluginConstructor';
import { PluginLoader } from './PluginLoader';
import { RateLimitManager } from '../command/RateLimitManager';
import { ResolverConstructor } from '../types/ResolverConstructor';
import { ResolverLoader } from '../command/resolvers/ResolverLoader';
import { StorageProviderConstructor } from '../types/StorageProviderConstructor';
import { Time } from '../util/Time';
import { Util } from '../util/Util';
import { Message as YAMDBFMessage } from '../types/Message';
import { YAMDBFOptions } from '../types/YAMDBFOptions';

const { on, once, registerListeners } = ListenerUtil;

/**
 * The YAMDBF Client through which you can access [storage]{@link Client#storage}
 * and any of the properties available on a typical Discord.js Client instance
 * @extends {external:Client}
 * @param {YAMDBFOptions} options Object containing required client properties
 * @param {external:ClientOptions} [clientOptions] Discord.js ClientOptions
 */
export class Client extends Discord.Client
{
	@logger('Client')
	private readonly _logger!: Logger;

	private readonly _token: string;
	private readonly _plugins: (PluginConstructor | string)[];
	private readonly _guildStorageLoader: GuildStorageLoader;
	private readonly _commandLoader!: CommandLoader;
	private readonly _dispatcher!: CommandDispatcher;
	private _ratelimit!: string;

	public readonly commandsDir: string | null;
	public readonly eventsDir: string | null;
	public readonly localeDir: string | null;
	public readonly owner: string[];
	public readonly defaultLang: string;
	public readonly statusText: string | null;
	public readonly readyText: string;
	public readonly unknownCommandError: boolean;
	public readonly dmHelp: boolean;
	public readonly passive: boolean;
	public readonly pause: boolean;
	public readonly disableBase: BaseCommandName[];
	public readonly provider: StorageProviderConstructor;
	public readonly plugins: PluginLoader;
	public readonly storage: ClientStorage;
	public readonly commands: CommandRegistry<this>;
	public readonly rateLimitManager: RateLimitManager;
	public readonly eventLoader!: EventLoader;
	public readonly resolvers: ResolverLoader;
	public readonly argsParser: (input: string, command?: Command, message?: YAMDBFMessage) => string[];
	public readonly buttons: { [key: string]: string };
	public readonly compact: boolean;
	public readonly tsNode: boolean;

	// Internals
	public readonly middleware: MiddlewareFunction[];
	public readonly customResolvers: ResolverConstructor[];

	// eslint-disable-next-line complexity
	public constructor(options: YAMDBFOptions, clientOptions?: ClientOptions)
	{
		super(clientOptions);
		Reflect.defineMetadata('YAMDBFClient', true, this);

		// Hook logger to provide shard ID(s) in base transport logs
		if (this.shard) Logger.shard = this.shard.ids.join('-');

		this._token = options.token! ?? process.env.DISCORD_TOKEN!;

		/**
		 * The owner/owners of the bot, represented as an array of IDs.
		 * These IDs determine who is allowed to use commands flagged as
		 * `ownerOnly`
		 * @type {string[]}
		 */
		this.owner = typeof options.owner !== 'undefined'
			? options.owner instanceof Array
				? options.owner
				: [options.owner]
			: [];

		/**
		 * Directory to find command class files. Optional
		 * if client is passive.<br>
		 * **See:** {@link Client#passive}
		 * @type {string}
		 */
		this.commandsDir = options.commandsDir ? Path.resolve(options.commandsDir) : null;

		/**
		 * Directory to find Event class files. Optional
		 * if client is passive.<br>
		 * **See:** {@link Client#passive}
		 * @type {string}
		 */
		this.eventsDir = options.eventsDir ? Path.resolve(options.eventsDir) : null;

		/**
		 * Directory to find custom localization files
		 * @type {string}
		 */
		this.localeDir = options.localeDir ? Path.resolve(options.localeDir) : null;

		/**
		 * Default language to use for localization
		 * @type {string}
		 */
		this.defaultLang = options.defaultLang ?? 'en_us';

		/**
		 * Status text for the client
		 * @type {string}
		 */
		this.statusText = options.statusText ?? null;

		/**
		 * Text to output when the client is ready. If not
		 * provided nothing will be logged, giving the
		 * opportunity to log something more dynamic
		 * on `clientReady`
		 * @type {string}
		 */
		this.readyText = options.readyText!;

		/**
		 * Whether or not a generic 'command not found' message
		 * should be given in DMs to instruct the user to
		 * use the `help` command. `true` by default
		 * @type {boolean}
		 */
		this.unknownCommandError = options.unknownCommandError ?? true;

		/**
		 * Whether or not the help command should send its output
		 * in a DM to the command caller
		 * @type {boolean}
		 */
		this.dmHelp = options.dmHelp ?? true;

		/**
		 * Whether or not this client is passive. Passive clients
		 * will not register a command dispatcher or a message
		 * listener. This allows passive clients to be created that
		 * do not respond to any commands but are able to perform
		 * actions based on whatever the framework user wants
		 * @type {boolean}
		 */
		this.passive = options.passive ?? false;

		/**
		 * Whether or not the client will pause after loading Client
		 * Storage, giving the opportunity to add/change default
		 * settings before guild settings are created for the first
		 * time. If this is used, you must create a listener for `'pause'`,
		 * and call `<Client>.continue()` when you have finished doing
		 * what you need to do.
		 *
		 * If adding new default settings is desired *after* guild settings
		 * have already been generated for the first time, they should be
		 * added after `'clientReady'` so they can be properly pushed to
		 * the settings for all guilds
		 * @type {boolean}
		 */
		this.pause = options.pause ?? false;

		/**
		 * Array of base command names to skip when loading commands. Base commands
		 * may only be disabled by name, not by alias
		 * @type {BaseCommandName[]}
		 */
		this.disableBase = options.disableBase ?? [];

		// Set the global ratelimit if provided
		if (options.ratelimit) this.ratelimit = options.ratelimit;

		/**
		 * A convenient instance of {@link RateLimitManager} for use anywhere
		 * the Client is available
		 * @type {RateLimitManager}
		 */
		this.rateLimitManager = new RateLimitManager();

		/**
		 * The EventLoader the client uses to load events. The client will load events
		 * from the `eventsdir` directory passed in your `YAMDBFOptions`.
		 *
		 * Can be used by plugins to register directories to load custom event handlers from
		 * @type {EventLoader}
		 */
		this.eventLoader = new EventLoader(this);

		// Set the logger level if provided
		if (typeof options.logLevel !== 'undefined')
			this._logger.setLogLevel(options.logLevel);

		/**
		 * The chosen storage provider to use for the Client.
		 * Defaults to {@link JSONProvider}
		 * @type {StorageProvider}
		 */
		this.provider = options.provider ?? JSONProvider;

		// Plugins to load
		this._plugins = options.plugins ?? [];

		/**
		 * Loads plugins and contains loaded plugins in case
		 * accessing a loaded plugin at runtime is desired
		 * @type {PluginLoader}
		 */
		this.plugins = new PluginLoader(this, this._plugins);

		// Middleware function storage for the client instance
		this.middleware = [];

		/**
		 * Client-specific storage. Also contains a `guilds` Collection property containing
		 * all GuildStorage instances
		 * @type {ClientStorage}
		 */
		this.storage = new ClientStorage(this);

		this._guildStorageLoader = new GuildStorageLoader(this);

		/**
		 * [Collection]{@link external:Collection} containing all loaded commands
		 * @type {CommandRegistry<string, Command>}
		 */
		this.commands = new CommandRegistry<this, string, Command<this>>(this);

		/**
		 * ResolverLoader instance containing loaded argument resolvers
		 * @type {ResolverLoader}
		 */
		this.resolvers = new ResolverLoader(this);
		this.customResolvers = options.customResolvers ?? [];
		this.resolvers.loadResolvers();

		/**
		 * Whether or not compact mode is enabled
		 * @type {boolean}
		 */
		this.compact = typeof options.compact !== 'undefined'
			? options.compact
			: false;

		/**
		 * Button shortcuts for compact mode. Defaults are
		 * `success`, `fail`, and `working`. These can be overwritten
		 * via the `buttons` field in {@link YAMDBFOptions}
		 * @type {object}
		 */
		this.buttons = {
			success: '✅',
			fail: '❌',
			working: '🕐',
			...options.buttons ?? {}
		};

		/**
		 * The argument parsing function the framework will use to parse
		 * command arguments from message content input. Defaults to
		 * splitting on {@link Command#argOpts.separator}
		 * @type {Function}
		 */
		this.argsParser = options.argsParser ?? Util.parseArgs;

		/**
		 * Whether or not ts-node is in use, allowing the Client
		 * to attempt to load .ts files when loading Commands
		 * @type {boolean}
		 */
		this.tsNode = options.tsNode ?? false;

		Lang.createInstance(this);
		Lang.loadLocalizations();

		CompactModeHelper.createInstance(this);

		if (!this.passive)
		{
			this._commandLoader = new CommandLoader(this);
			this._dispatcher = new CommandDispatcher(this);

			if (this.eventsDir)
				this.eventLoader.addSourceDir(this.eventsDir);

			this._logger.info('Loading base commands...');
			this._commandLoader.loadCommandsFrom(Path.join(__dirname, '../command/base'), true);

			// Disable setlang command if there is only one language
			if (Lang.langNames.length === 1
				&& !this.disableBase.includes('setlang')
				&& this.commands.has('setlang'))
				this.commands.get('setlang')!.disable();
		}

		registerListeners(this);
	}

	// #region Event handlers

	// @ts-ignore - Handled via ListenerUtil
	// eslint-disable-next-line @typescript-eslint/naming-convention
	@once('ready') private async __onReadyEvent(): Promise<void>
	{
		// Set default owner (OAuth Application owner) if none exists
		if (this.owner.length < 1)
		{
			const app: ClientApplication = await this.fetchApplication();
			if (typeof app.owner !== 'undefined')
				this.owner[0] = app.owner!.id;
		}

		await this.storage.init();

		// Load defaultGuildSettings into storage the first time the client is run
		if (!await this.storage.exists('defaultGuildSettings'))
			await this.storage.set('defaultGuildSettings',
				require('../storage/defaultGuildSettings.json'));

		if (this.pause) this.emit('pause');
		else this.__onContinueEvent();

		if (this.statusText)
			this.user!.setActivity(this.statusText);
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	@once('continue') private async __onContinueEvent(): Promise<void>
	{
		await this._guildStorageLoader.init();
		await this._guildStorageLoader.loadStorages();
		await this._guildStorageLoader.cleanGuilds();

		this._logger.info('Loading plugins...');
		await this.plugins.loadPlugins();

		if (!this.passive)
		{
			if (this.commandsDir)
			{
				this._logger.info('Loading custom commands...');
				this._commandLoader.loadCommandsFrom(this.commandsDir);
			}

			this.commands.checkDuplicateAliases();
			this.commands.checkReservedCommandNames();

			this._logger.info('Initializing commands...');
			const initSuccess: boolean = await this.commands.initCommands();
			this._logger.info(`Commands initialized${initSuccess ? '' : ' with errors'}.`);

			Lang.loadCommandLocalizations();

			this._dispatcher.setReady();
			const commands: number = this.commands.size;
			const groups: number = this.commands.groups.length;
			this._logger.info(
				`Command dispatcher ready -- ${commands} commands in ${groups} groups`
			);

			if (this.eventLoader.hasSources())
			{
				this._logger.info('Loading events from registered sources...');
				this.eventLoader.loadFromSources();
			}
		}

		if (typeof this.readyText !== 'undefined')
			this._logger.log(this.readyText);

		this.emit('clientReady');

		if (!this.user!.bot)
			this._logger.warn([
				'Userbots are no longer supported and no precautions are',
				'taken to protect your account from accidentally abusing',
				'the Discord API. Creating a userbot is NOT recommended.'
			].join(' '));
	}

	// @ts-ignore - Handled via ListenerUtil
	// eslint-disable-next-line @typescript-eslint/naming-convention
	@on('guildCreate') private async __onGuildCreateEvent(guild: Guild): Promise<void>
	{
		if (this.storage.guilds.has(guild.id))
		{
			// Handle guild returning to the same shard in the same session
			const storage: GuildStorage = this.storage.guilds.get(guild.id)!;
			if (await storage.settings.exists('YAMDBFInternal.remove'))
				await storage.settings.remove('YAMDBFInternal.remove');
		}
		else await this._guildStorageLoader.loadStorages();
	}

	// @ts-ignore - Handled via ListenerUtil
	// eslint-disable-next-line @typescript-eslint/naming-convention
	@on('guildDelete') private __onGuildDeleteEvent(guild: Guild): void
	{
		if (this.storage.guilds.has(guild.id))
			this.storage.guilds.get(guild.id)!.settings.set(
				'YAMDBFInternal.remove', Date.now() + Time.parseShorthand('7d')!
			);
	}

	// #endregion

	// #region Getters/Setters

	/**
	 * The global ratelimit for all command usage per user
	 * @type {string}
	 */
	public get ratelimit(): string { return this._ratelimit; }
	public set ratelimit(value: string)
	{
		Util.parseRateLimit(value);
		this._ratelimit = value;
	}

	// #endregion

	/**
	 * Starts the login process, culminating in the `clientReady` event
	 * @returns {Client}
	 */
	public start(): this
	{
		if (!this._token)
			throw new Error('Client cannot be started without being given a token.');

		this.login(this._token);
		return this;
	}

	/**
	 * Shortcut method for `<Client>.emit('continue')`
	 * @returns {void}
	 */
	protected continue(): void
	{
		this.emit('continue');
	}

	/**
	 * Returns whether or not the given user is an owner
	 * of the client/bot
	 * @param {external:User} user User to check
	 * @returns {boolean}
	 */
	public isOwner(user: User): boolean
	{
		return this.owner.includes(user.id);
	}

	/**
	 * Set the value of a default setting key and push it to all guild
	 * setting storages. Will not overwrite a setting in guild settings
	 * storage if there is already an existing key with the given value
	 * @param {string} key The key to use in settings storage
	 * @param {any} value The value to use in settings storage
	 * @returns {Promise<Client>}
	 */
	public async setDefaultSetting(key: string, value: any): Promise<this>
	{
		await this.storage.set(`defaultGuildSettings.${key}`, value);
		for (const guildStorage of this.storage.guilds.values())
			if (!await guildStorage.settings.exists(key))
				await guildStorage.settings.set(key, value);

		return this;
	}

	/**
	 * Remove a `defaultGuildSettings` item. Will not remove from any current
	 * guild settings, but will remove the item from the defaults added to
	 * new guild settings storages upon creation
	 * @param {string} key The key to use in settings storage
	 * @returns {Promise<Client>}
	 */
	public async removeDefaultSetting(key: string): Promise<this>
	{
		await this.storage.remove(`defaultGuildSettings.${key}`);
		return this;
	}

	/**
	 * Check if a default guild setting exists
	 * @param {string} key The default settings key to check for
	 * @returns {Promise<boolean>}
	 */
	public async defaultSettingExists(key: string): Promise<boolean>
	{
		return this.storage.exists(`defaultGuildSettings.${key}`);
	}

	/**
	 * Shortcut to return the command prefix for the provided guild
	 * @param {external:Guild} guild The Guild to get the prefix of
	 * @returns {Promise<string | null>}
	 */
	public async getPrefix(guild: Guild): Promise<string | null>
	{
		if (!guild || !this.storage.guilds.has(guild.id)) return null;
		return await this.storage.guilds.get(guild.id)!.settings.get('prefix') ?? null;
	}

	/**
	 * Generate a bot invite URL based on the permissions included
	 * in all of the commands the client currently has loaded.
	 *
	 * >**Note:** This should be run after `clientReady` to ensure
	 * no command permissions are missing from the permissions set
	 * that will be used to generate the URL
	 * @returns {Promise<string>}
	 */
	public async createBotInvite(): Promise<string>
	{
		const perms: Set<PermissionResolvable> = new Set();
		for (const command of this.commands.values())
			for (const perm of command.clientPermissions)
				perms.add(perm);

		return this.generateInvite({ permissions: Array.from(perms) });
	}

	/**
	 * Clean out expired guild storage/settings
	 * @returns {Promise<void>}
	 */
	public async sweepStorages(): Promise<void>
	{
		await this._guildStorageLoader.cleanGuilds();
	}

	/**
	 * Adds a middleware function to be used when any command is called
	 * to make modifications to args, determine if the command can
	 * be run, or anything else you want to do every time any command
	 * is called.
	 *
	 * See {@link MiddlewareFunction} for information on how a middleware
	 * function should be represented
	 *
	 * Usage example:
	 * ```
	 * <Client>.use((message, args) => [message, args.map(a => a.toUpperCase())]);
	 * ```
	 * This will add a middleware function to all commands that will attempt
	 * to transform all args to uppercase. This will of course fail if any
	 * of the args are not a string.
	 *
	 * >**Note:** Middleware functions should only be added to the client one
	 * time each and thus should not be added within any sort of event or loop.
	 * Multiple separate middleware functions can be added to the via multiple
	 * separate calls to this method
	 *
	 * >**Warning:** Do not use middleware for overriding the default argument
	 * splitting. Use {@link YAMDBFOptions.argsParser} instead. Otherwise
	 * you will see inconsistent results when using Command shortcuts, as
	 * argument splitting for shortcut interpolation always happens before
	 * middleware is run
	 * @param {MiddlewareFunction} func The middleware function to use
	 * @returns {Client}
	 */
	public use(func: MiddlewareFunction): this
	{
		this.middleware.push(func);
		return this;
	}

	/**
	 * Reload custom commands. Used internally by the `reload` command
	 * @private
	 */
	public reloadCustomCommands(): number
	{
		if (!this.commandsDir)
			throw new Error('Client is missing `commandsDir`, cannot reload Commands');

		return this._commandLoader.loadCommandsFrom(this.commandsDir);
	}

	/**
	 * Reload Events from all registered event source directories
	 * @private
	 */
	public reloadEvents(): number
	{
		return this.eventLoader.loadFromSources();
	}

	// #region Discord.js on() events

	public on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void): this;
	public on<S extends string | symbol>(
		event: Exclude<S, keyof ClientEvents>,
		listener: (...args: any[]) => void,
	): this;

	// #endregion

	public on(
		event: 'command',
		listener: (name: string, args: any[], execTime: number, message: Message) => void
	): this;

	public on(
		event: 'unknownCommand',
		listener: (name: string, args: any[], message: Message) => void
	): this;

	public on(event: 'noCommand', listener: (message: Message) => void): this;
	public on(event: 'blacklistAdd' | 'blacklistRemove', listener: (user: User, global: boolean) => void): this;
	public on(event: 'pause' | 'continue' | 'clientReady', listener: () => void): this;

	/**
	 * Emitted whenever a command is successfully called
	 * @memberof Client
	 * @event event:command
	 * @param {string} name Name of the called command
	 * @param {any[]} args Args passed to the called command
	 * @param {number} execTime Time command took to execute
	 * @param {external:Message} message Message that triggered the command
	 */

	/**
	 * Emitted whenever a command is called that doesn't exist
	 * @memberof Client
	 * @event event:unknownCommand
	 * @param {string} name The name of the command that was attempted to be called
	 * @param {any[]} args Args passed to the unknown command
	 * @param {external:Message} message Message that triggered the unknown command
	 */

	/**
	 * Emitted whenever a message is received that does not contain a command or unknown command
	 * @memberof Client
	 * @event event:noCommand
	 * @param {external:Message} message Message that did not contain a command or unknown command
	 */

	/**
	 * Emitted whenever a user is blacklisted
	 * @memberof Client
	 * @event event:blacklistAdd
	 * @param {User} user User who was blacklisted
	 * @param {boolean} global Whether or not blacklisting is global
	 */

	/**
	 * Emitted whenever a user is removed from the blacklist
	 * @memberof Client
	 * @event event:blacklistRemove
	 * @param {User} user User who was removed
	 * @param {boolean} global Whether or not removal is global
	 */

	/**
	 * Emitted when the client is waiting for you to send a `continue` event,
	 * after which `clientReady` will be emitted
	 * @memberof Client
	 * @event event:pause
	 */

	/**
	 * To be emitted after the `pause` event when you have finished setting
	 * things up that should be set up before the client is ready for use
	 * @memberof Client
	 * @event event:continue
	 */

	/**
	 * Emitted when the client is ready. Should be used instead of Discord.js'
	 * `ready` event, as this is the point that everything is set up within the
	 * YAMDBF Client and it's all ready to go
	 * @memberof Client
	 * @event event:clientReady
	 */

	// on() wrapper to support overload signatures
	public on(event: string, listener: (...args: any[]) => void): this
	{
		return super.on(event, listener);
	}

	// #region Discord.js once() events

	public once<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void): this;
	public once<S extends string | symbol>(
		event: Exclude<S, keyof ClientEvents>,
		listener: (...args: any[]) => void,
	): this;

	// #endregion

	public once(
		event: 'command',
		listener: (name: string, args: any[], execTime: number, message: Message) => void
	): this;

	public once(event: 'unknownCommand', listener: (name: string, args: any[], message: Message) => void): this;
	public once(event: 'noCommand', listener: (message: Message) => void): this;
	public once(event: 'blacklistAdd' | 'blacklistRemove', listener: (user: User, global: boolean) => void): this;
	public once(event: 'pause' | 'continue' | 'clientReady', listener: () => void): this;

	// Once() wrapper to support overload signatures
	public once(event: string, listener: (...args: any[]) => void): this
	{
		return super.once(event, listener);
	}
}
