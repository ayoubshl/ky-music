const express = require("express");
const app = express();

// Basic route to respond to pings
app.get("/", (req, res) => {
  res.send("Bot is running!");
});

// Listen on the port provided by Replit environment or 3000 by default
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  VoiceConnectionStatus,
  StreamType,
} = require("@discordjs/voice");

// Using YouTubei.js - Most reliable YouTube library
const { Innertube, UniversalCache, YT } = require("youtubei.js");
// Removed ytdl-core and yt-search - using only YouTube.js
const SpotifyWebApi = require("spotify-web-api-node");

class YKMusicBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Bot state
    this.queues = new Map();
    this.players = new Map();
    this.nowPlaying = new Map();
    this.settings = new Map();

    // YouTube instance
    this.youtube = null;

    // Spotify instance
    this.spotify = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });

    // Initialize
    this.init();
  }

  async init() {
    try {
      // Initialize YouTube.js
      console.log("🔄 Initializing YouTube.js...");
      this.youtube = await Innertube.create({
        cache: new UniversalCache(),
        enable_session_cache: true,
      });
      console.log("✅ YouTube.js initialized successfully");

      // Initialize Spotify
      if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
        const data = await this.spotify.clientCredentialsGrant();
        this.spotify.setAccessToken(data.body["access_token"]);
        console.log("✅ Spotify initialized successfully");
      }
    } catch (error) {
      console.error("❌ Initialization failed:", error);
      // Fallback initialization
      this.youtube = await YT.create();
    }

    this.setupEventListeners();
    this.client.login(process.env.TOKEN);
  }

  setupEventListeners() {
    this.client.once("ready", () => {
      console.log(`
🎵 ═══════════════════════════════════════
   YK MUSIC BOT - UNIVERSAL EDITION v4.0
   Bot: ${this.client.user.tag}
   Servers: ${this.client.guilds.cache.size}
   Status: ONLINE & READY TO ROCK! 🚀
   Supports: YouTube, Spotify, Playlists!
═══════════════════════════════════════ 🎵
            `);
      this.client.user.setActivity("🎶 yk help | Universal Music Bot!", {
        type: 2, // LISTENING
      });
    });

    this.client.on("messageCreate", async (message) => {
      if (!message.guild || message.author.bot) return;
      await this.handleCommand(message);
    });

    this.client.on("guildCreate", (guild) => {
      this.sendWelcomeMessage(guild);
    });

    this.client.on("voiceStateUpdate", (oldState, newState) => {
      this.handleVoiceStateUpdate(oldState, newState);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      }
    });
  }

  getGuildQueue(guildId) {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, []);
    }
    return this.queues.get(guildId);
  }

  getGuildPlayer(guildId) {
    if (!this.players.has(guildId)) {
      const player = createAudioPlayer();
      this.players.set(guildId, player);

      player.on(AudioPlayerStatus.Playing, () => {
        console.log(`🎵 Now playing in guild ${guildId}`);
      });

      player.on(AudioPlayerStatus.Idle, async () => {
        const queue = this.getGuildQueue(guildId);
        if (queue.length > 0) {
          await this.playNext(guildId);
        } else {
          this.nowPlaying.delete(guildId);
          // Fixed timeout - use proper positive value
          setTimeout(() => {
            const connection = getVoiceConnection(guildId);
            if (connection && this.getGuildQueue(guildId).length === 0) {
              connection.destroy();
            }
          }, 300000); // 5 minutes
        }
      });

      player.on("error", (error) => {
        console.error(`❌ Player error in guild ${guildId}:`, error);
        // Auto-skip on error with proper delay
        setTimeout(() => {
          const queue = this.getGuildQueue(guildId);
          if (queue.length > 0) {
            this.playNext(guildId);
          } else {
            this.nowPlaying.delete(guildId);
          }
        }, 3000); // 3 second delay to avoid negative timeout
      });
    }
    return this.players.get(guildId);
  }

  async handleCommand(message) {
    const args = message.content.toLowerCase().split(" ");
    if (!args[0].startsWith("yk")) return;

    const command = args[1];
    const query = args.slice(2).join(" ");

    switch (command) {
      case "p":
      case "play":
        await this.handlePlay(message, query);
        break;
      case "search":
        await this.handleSearch(message, query);
        break;
      case "s":
      case "skip":
        await this.handleSkip(message);
        break;
      case "x":
      case "stop":
        await this.handleStop(message);
        break;
      case "pa":
      case "pause":
        await this.handlePause(message);
        break;
      case "r":
      case "resume":
        await this.handleResume(message);
        break;
      case "q":
      case "queue":
        await this.handleQueue(message);
        break;
      case "sh":
      case "shuffle":
        await this.handleShuffle(message);
        break;
      case "rm":
      case "remove":
        await this.handleRemove(message, parseInt(args[2]));
        break;
      case "np":
      case "nowplaying":
        await this.handleNowPlaying(message);
        break;
      case "clear":
        await this.handleClear(message);
        break;
      case "help":
        await this.handleHelp(message);
        break;
      default:
        await this.sendQuickHelp(message);
    }
  }

  async handlePlay(message, query) {
    if (!query) {
      return this.sendErrorEmbed(
        message,
        "Please provide a YouTube/Spotify URL or song name"
      );
    }

    if (!message.member.voice.channel) {
      return this.sendErrorEmbed(
        message,
        "You need to join a voice channel first!"
      );
    }

    const loadingEmbed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle("🔍 Searching...")
      .setDescription("Finding your music...")
      .setTimestamp();

    const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });

    try {
      // Check if it's a YouTube radio/autoplay link - handle specially
      if (query.includes("start_radio=1") || query.includes("&list=RD")) {
        console.log("📻 YouTube radio/autoplay link detected");
        // Extract the main video ID and ignore radio parameters
        const videoId = this.extractVideoId(query);
        if (videoId) {
          query = `https://www.youtube.com/watch?v=${videoId}`;
          console.log(`🎯 Cleaned URL: ${query}`);
        }
      }

      // Check if it's a playlist or single track
      if (this.isPlaylistUrl(query) && !query.includes("start_radio=1")) {
        await this.handlePlaylist(message, query, loadingMsg);
        return;
      }

      const songInfo = await this.getSongInfo(query);
      if (!songInfo) {
        return loadingMsg.edit({
          embeds: [
            this.createErrorEmbed(
              "Could not find that song. The video might be unavailable, private, or region-blocked."
            ),
          ],
        });
      }

      const queue = this.getGuildQueue(message.guild.id);
      queue.push(songInfo);

      // Connect to voice channel if not connected
      let connection = getVoiceConnection(message.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        connection.subscribe(this.getGuildPlayer(message.guild.id));
      }

      if (queue.length === 1) {
        await this.playNext(message.guild.id);
        const embed = this.createNowPlayingEmbed(songInfo);
        await loadingMsg.edit({
          embeds: [embed],
          components: [this.createMusicControls()],
        });
      } else {
        const queueEmbed = new EmbedBuilder()
          .setColor(0x00ff88)
          .setTitle("✅ Added to Queue")
          .setDescription(
            `**[${songInfo.title}](${songInfo.url})**\nBy ${songInfo.artist}`
          )
          .setThumbnail(songInfo.thumbnail)
          .addFields({
            name: "📍 Position in Queue",
            value: `#${queue.length}`,
            inline: true,
          })
          .setTimestamp();

        await loadingMsg.edit({ embeds: [queueEmbed] });
      }
    } catch (error) {
      console.error("❌ Play error:", error);
      await loadingMsg.edit({
        embeds: [
          this.createErrorEmbed("Failed to play song: " + error.message),
        ],
      });
    }
  }

  isPlaylistUrl(url) {
    return (
      url.includes("playlist") ||
      url.includes("/album/") ||
      url.includes("/artist/") ||
      (url.includes("youtube.com") && url.includes("list=")) ||
      (url.includes("spotify.com") &&
        (url.includes("/playlist/") || url.includes("/album/")))
    );
  }

  async handlePlaylist(message, url, loadingMsg) {
    try {
      let tracks = [];

      if (url.includes("spotify.com")) {
        tracks = await this.getSpotifyPlaylist(url);
      } else if (url.includes("youtube.com")) {
        tracks = await this.getYouTubePlaylist(url);
      }

      if (!tracks || tracks.length === 0) {
        return loadingMsg.edit({
          embeds: [
            this.createErrorEmbed("Could not load playlist or it's empty"),
          ],
        });
      }

      const queue = this.getGuildQueue(message.guild.id);
      const wasEmpty = queue.length === 0;

      // Add all tracks to queue
      for (const track of tracks) {
        const songInfo = await this.getSongInfo(track);
        if (songInfo) {
          queue.push(songInfo);
        }
      }

      // Connect and play if queue was empty
      let connection = getVoiceConnection(message.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        connection.subscribe(this.getGuildPlayer(message.guild.id));
      }

      if (wasEmpty && queue.length > 0) {
        await this.playNext(message.guild.id);
      }

      const playlistEmbed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("📚 Playlist Added")
        .setDescription(`Added ${tracks.length} songs to the queue!`)
        .addFields(
          {
            name: "📍 Queue Length",
            value: `${queue.length} songs`,
            inline: true,
          },
          {
            name: "🎵 Status",
            value: wasEmpty ? "Playing now!" : "Added to queue",
            inline: true,
          }
        )
        .setTimestamp();

      await loadingMsg.edit({ embeds: [playlistEmbed] });
    } catch (error) {
      console.error("❌ Playlist error:", error);
      await loadingMsg.edit({
        embeds: [
          this.createErrorEmbed("Failed to load playlist: " + error.message),
        ],
      });
    }
  }

  async getSpotifyPlaylist(url) {
    try {
      let tracks = [];
      const spotifyId = this.extractSpotifyId(url);

      if (url.includes("/playlist/")) {
        const playlist = await this.spotify.getPlaylist(spotifyId);
        tracks = playlist.body.tracks.items.map(
          (item) => `${item.track.artists[0].name} ${item.track.name}`
        );
      } else if (url.includes("/album/")) {
        const album = await this.spotify.getAlbum(spotifyId);
        tracks = album.body.tracks.items.map(
          (item) => `${item.artists[0].name} ${item.name}`
        );
      } else if (url.includes("/track/")) {
        const track = await this.spotify.getTrack(spotifyId);
        tracks = [`${track.body.artists[0].name} ${track.body.name}`];
      }

      return tracks;
    } catch (error) {
      console.error("❌ Spotify error:", error);
      return [];
    }
  }

  async getYouTubePlaylist(url) {
    try {
      const playlistId = this.extractPlaylistId(url);
      if (!playlistId) return [];

      const playlist = await this.youtube.getPlaylist(playlistId);
      const tracks = [];

      for (const video of playlist.videos) {
        if (video.title && video.title.text) {
          tracks.push(video.title.text);
        }
      }

      return tracks.slice(0, 50); // Limit to 50 songs
    } catch (error) {
      console.error("❌ YouTube playlist error:", error);
      return [];
    }
  }

  extractSpotifyId(url) {
    const regex = /(?:playlist\/|album\/|track\/)([a-zA-Z0-9]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  extractPlaylistId(url) {
    const regex = /[?&]list=([^&]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  async getSongInfo(query) {
    try {
      console.log(`🔍 Searching for: ${query}`);

      // Check if it's a Spotify URL
      if (query.includes("spotify.com/track/")) {
        const track = await this.getSpotifyTrack(query);
        if (track) {
          query = track; // Convert Spotify track to search query
        }
      }

      // Check if it's a YouTube URL (handle all YouTube URL formats)
      if (this.isYouTubeUrl(query)) {
        console.log("🎥 Direct YouTube URL detected");
        try {
          const videoId = this.extractVideoId(query);
          if (!videoId) throw new Error("Invalid video ID");

          console.log(`🎯 Extracted video ID: ${videoId}`);
          const video = await this.youtube.getInfo(videoId);

          // Check if video is available
          if (
            !video.basic_info.is_live &&
            video.basic_info.view_count !== undefined
          ) {
            return {
              title: video.basic_info.title,
              artist: video.basic_info.author,
              url: `https://www.youtube.com/watch?v=${video.basic_info.id}`,
              thumbnail: video.basic_info.thumbnail?.[0]?.url,
              duration: this.formatDuration(
                video.basic_info.duration?.seconds_total || 0
              ),
              platform: "youtube",
              videoInfo: video,
            };
          } else {
            console.log("❌ Video is live or unavailable");
            throw new Error("Video is live or unavailable");
          }
        } catch (urlError) {
          console.log("❌ Direct URL failed:", urlError.message);
          // Fall through to search using the video title or original query
          if (urlError.message.includes("unavailable")) {
            // Try to extract title from URL or use original query for search
            const cleanQuery =
              query.replace(/https?:\/\/[^\s]+/, "").trim() || query;
            console.log(`🔄 Searching instead with: ${cleanQuery}`);
            query = cleanQuery;
          }
        }
      }

      // Search YouTube using YouTube.js
      console.log(`🎯 Searching YouTube for: "${query}"`);
      const search = await this.youtube.search(query, {
        type: "video",
      });

      if (!search.videos || search.videos.length === 0) {
        console.log("❌ No search results found");
        return null;
      }

      // Try each result until we find a working one
      for (let i = 0; i < Math.min(5, search.videos.length); i++) {
        const video = search.videos[i];

        try {
          const videoTitle = video.title?.text || video.title || "Unknown";
          const authorName = video.author?.name || "Unknown";

          console.log(`🎵 Trying: ${videoTitle} by ${authorName}`);

          // Get detailed info
          const detailedVideo = await this.youtube.getInfo(video.id);

          // Skip live videos and unavailable videos
          if (detailedVideo.basic_info.is_live) {
            console.log("⚡ Skipping live video");
            continue;
          }

          console.log(
            `✅ Found working video: ${detailedVideo.basic_info.title}`
          );
          return {
            title: detailedVideo.basic_info.title,
            artist: detailedVideo.basic_info.author,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            thumbnail: detailedVideo.basic_info.thumbnail?.[0]?.url,
            duration: this.formatDuration(
              detailedVideo.basic_info.duration?.seconds_total || 0
            ),
            platform: "youtube",
            videoInfo: detailedVideo,
          };
        } catch (videoError) {
          console.log(`❌ Video ${i + 1} failed:`, videoError.message);
          continue;
        }
      }

      console.log("❌ All search results failed");
      return null;
    } catch (error) {
      console.error("❌ Error getting song info:", error.message);
      return null;
    }
  }

  async getSpotifyTrack(url) {
    try {
      const trackId = this.extractSpotifyId(url);
      const track = await this.spotify.getTrack(trackId);
      return `${track.body.artists[0].name} ${track.body.name}`;
    } catch (error) {
      console.error("❌ Spotify track error:", error);
      return null;
    }
  }

  isYouTubeUrl(url) {
    return (
      url.includes("youtube.com/watch") ||
      url.includes("youtu.be/") ||
      url.includes("youtube.com/embed/") ||
      url.includes("m.youtube.com/watch") ||
      url.includes("music.youtube.com/watch")
    );
  }

  extractVideoId(url) {
    // Handle all YouTube URL formats including radio/autoplay
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
      /(?:youtu\.be\/)([^&\n?#]+)/,
      /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
      /(?:m\.youtube\.com\/watch\?v=)([^&\n?#]+)/,
      /(?:music\.youtube\.com\/watch\?v=)([^&\n?#]+)/,
      /(?:youtube\.com\/v\/)([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        console.log(`🎯 Extracted video ID: ${match[1]} from URL: ${url}`);
        return match[1];
      }
    }

    console.log(`❌ Could not extract video ID from: ${url}`);
    return null;
  }

  async playNext(guildId) {
    const queue = this.getGuildQueue(guildId);
    const player = this.getGuildPlayer(guildId);

    if (queue.length === 0) {
      this.nowPlaying.delete(guildId);
      return;
    }

    const song = queue.shift();
    this.nowPlaying.set(guildId, song);

    try {
      console.log(`🎵 Preparing to play: ${song.title}`);
      console.log(`🔗 URL: ${song.url}`);

      let stream;
      let inputType = StreamType.Arbitrary;
      let success = false;

      // Ensure we have video info
      if (!song.videoInfo) {
        console.log("🔄 Getting video info...");
        song.videoInfo = await this.youtube.getInfo(
          this.extractVideoId(song.url)
        );
      }

      // Strategy 1: Try adaptive audio formats (best quality)
      try {
        console.log("📻 Trying adaptive audio formats...");

        const adaptiveFormats =
          song.videoInfo.streaming_data?.adaptive_formats?.filter((format) =>
            format.mime_type?.includes("audio")
          );

        if (adaptiveFormats && adaptiveFormats.length > 0) {
          // Sort by bitrate (highest first)
          adaptiveFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

          for (const format of adaptiveFormats.slice(0, 3)) {
            // Try top 3 formats
            try {
              console.log(
                `🎵 Trying format: ${format.mime_type} @ ${
                  format.bitrate || "unknown"
                }bps`
              );
              stream = await song.videoInfo.download({ format: format });

              if (
                format.mime_type?.includes("webm") &&
                format.mime_type?.includes("opus")
              ) {
                inputType = StreamType.WebmOpus;
              } else {
                inputType = StreamType.Arbitrary;
              }

              success = true;
              console.log(`✅ Using format: ${format.mime_type}`);
              break;
            } catch (formatError) {
              console.log(`❌ Format failed: ${formatError.message}`);
              continue;
            }
          }
        }
      } catch (adaptiveError) {
        console.log("❌ Adaptive formats failed:", adaptiveError.message);
      }

      // Strategy 2: Try legacy formats
      if (!success) {
        try {
          console.log("📻 Trying legacy formats...");

          const legacyFormats = song.videoInfo.streaming_data?.formats?.filter(
            (format) => format.mime_type?.includes("audio") || format.has_audio
          );

          if (legacyFormats && legacyFormats.length > 0) {
            for (const format of legacyFormats.slice(0, 2)) {
              try {
                console.log(`🎵 Trying legacy format: ${format.mime_type}`);
                stream = await song.videoInfo.download({ format: format });
                inputType = StreamType.Arbitrary;
                success = true;
                console.log(`✅ Using legacy format: ${format.mime_type}`);
                break;
              } catch (formatError) {
                console.log(`❌ Legacy format failed: ${formatError.message}`);
                continue;
              }
            }
          }
        } catch (legacyError) {
          console.log("❌ Legacy formats failed:", legacyError.message);
        }
      }

      // Strategy 3: Simple audio download (most compatible)
      if (!success) {
        try {
          console.log("📻 Trying simple audio download...");
          stream = await song.videoInfo.download({
            type: "audio",
          });
          inputType = StreamType.Arbitrary;
          success = true;
          console.log("✅ Using simple audio download");
        } catch (simpleError) {
          console.log("❌ Simple download failed:", simpleError.message);
        }
      }

      // Strategy 4: Last resort - any available stream
      if (!success) {
        try {
          console.log("📻 Last resort - any stream...");
          stream = await song.videoInfo.download();
          inputType = StreamType.Arbitrary;
          success = true;
          console.log("✅ Using any available stream");
        } catch (lastResortError) {
          console.log("❌ Last resort failed:", lastResortError.message);
        }
      }

      if (!success || !stream) {
        throw new Error(
          "All streaming strategies failed - no playable stream found"
        );
      }

      // Create audio resource with enhanced error handling
      const resource = createAudioResource(stream, {
        inputType: inputType,
        inlineVolume: false,
      });

      // Enhanced stream error handling
      resource.playStream.on("error", (streamError) => {
        console.error("❌ Stream error:", streamError.message);
        // Try next song automatically
        setTimeout(() => {
          const currentQueue = this.getGuildQueue(guildId);
          if (currentQueue.length > 0) {
            console.log("⏭️ Auto-skipping due to stream error...");
            this.playNext(guildId);
          } else {
            this.nowPlaying.delete(guildId);
          }
        }, 2000);
      });

      // Play the resource
      player.play(resource);
      console.log(`✅ Successfully started playing: ${song.title}`);

      // Send success notification if possible
      try {
        const guild = this.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.find(
          (ch) => ch.type === 0 && ch.lastMessageId
        );

        if (channel && this.getGuildQueue(guildId).length === 0) {
          // Only send if this was the only song (not part of a queue)
          setTimeout(() => {
            const nowPlayingEmbed = this.createNowPlayingEmbed(song);
            channel
              .send({
                embeds: [nowPlayingEmbed],
                components: [this.createMusicControls()],
              })
              .catch(() => {}); // Silent fail if can't send
          }, 1000);
        }
      } catch (notificationError) {
        // Silent fail - notification is not critical
      }
    } catch (error) {
      console.error("❌ Critical playback error:", error.message);

      // Try next song if current fails
      const currentQueue = this.getGuildQueue(guildId);
      if (currentQueue.length > 0) {
        console.log(`⏭️ Skipping to next song due to critical error...`);
        setTimeout(() => this.playNext(guildId), 3000);
      } else {
        console.log(`❌ No more songs in queue`);
        this.nowPlaying.delete(guildId);

        // Send error message
        try {
          const guild = this.client.guilds.cache.get(guildId);
          const channel = guild?.channels.cache.find((ch) => ch.type === 0);
          if (channel) {
            const errorEmbed = this.createErrorEmbed(
              `❌ Could not play "${song.title}". ${
                currentQueue.length > 0
                  ? "Trying next song..."
                  : "Queue is empty."
              }\n\`Reason: ${error.message}\``
            );
            channel.send({ embeds: [errorEmbed] });
          }
        } catch (channelError) {
          console.log("Could not send error message");
        }
      }
    }
  }

  createNowPlayingEmbed(song) {
    return new EmbedBuilder()
      .setColor(0x00ffcc)
      .setTitle("🎵 Now Playing")
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: "🎤 Artist", value: song.artist, inline: true },
        {
          name: "⏱️ Duration",
          value: song.duration || "Unknown",
          inline: true,
        },
        { name: "📱 Platform", value: "YouTube", inline: true }
      )
      .setThumbnail(song.thumbnail)
      .setTimestamp()
      .setFooter({ text: "YK Music • Universal Edition v4.0" });
  }

  createMusicControls() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("music_pause")
        .setLabel("Pause")
        .setEmoji("⏸️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("music_skip")
        .setLabel("Skip")
        .setEmoji("⏭️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("music_stop")
        .setLabel("Stop")
        .setEmoji("⏹️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("music_queue")
        .setLabel("Queue")
        .setEmoji("📜")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("music_shuffle")
        .setLabel("Shuffle")
        .setEmoji("🔀")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  async handleButtonInteraction(interaction) {
    const { customId, guildId } = interaction;

    try {
      switch (customId) {
        case "music_pause":
          const player = this.getGuildPlayer(guildId);
          player.pause();
          await interaction.reply({
            content: "⏸️ Music paused",
            flags: 64, // EPHEMERAL flag instead of ephemeral: true
          });
          break;
        case "music_skip":
          await this.handleSkip({
            guild: { id: guildId },
            channel: interaction.channel,
          });
          await interaction.reply({
            content: "⏭️ Skipped!",
            flags: 64,
          });
          break;
        case "music_stop":
          await this.handleStop({
            guild: { id: guildId },
            channel: interaction.channel,
          });
          await interaction.reply({
            content: "⏹️ Stopped!",
            flags: 64,
          });
          break;
        case "music_queue":
          await this.handleQueue({
            guild: { id: guildId },
            channel: interaction.channel,
          });
          await interaction.reply({
            content: "📜 Queue displayed!",
            flags: 64,
          });
          break;
        case "music_shuffle":
          await this.handleShuffle({
            guild: { id: guildId },
            channel: interaction.channel,
          });
          await interaction.reply({
            content: "🔀 Queue shuffled!",
            flags: 64,
          });
          break;
      }
    } catch (error) {
      console.error("❌ Button interaction error:", error);
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ An error occurred",
          flags: 64,
        });
      }
    }
  }

  async handleSkip(message) {
    const player = this.getGuildPlayer(message.guild.id);
    const queue = this.getGuildQueue(message.guild.id);

    if (!this.nowPlaying.has(message.guild.id)) {
      return this.sendErrorEmbed(message, "Nothing is currently playing");
    }

    player.stop();

    const embed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("⏭️ Song Skipped")
      .setDescription(
        queue.length > 0 ? "Playing next song..." : "No more songs in queue"
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleStop(message) {
    const player = this.getGuildPlayer(message.guild.id);
    const queue = this.getGuildQueue(message.guild.id);

    queue.length = 0;
    player.stop();
    this.nowPlaying.delete(message.guild.id);

    const connection = getVoiceConnection(message.guild.id);
    if (connection) connection.destroy();

    const embed = new EmbedBuilder()
      .setColor(0xff4757)
      .setTitle("⏹️ Music Stopped")
      .setDescription("Queue cleared and disconnected")
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleQueue(message) {
    const queue = this.getGuildQueue(message.guild.id);
    const nowPlaying = this.nowPlaying.get(message.guild.id);

    if (!nowPlaying && queue.length === 0) {
      return this.sendErrorEmbed(message, "Queue is empty");
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📜 Music Queue")
      .setTimestamp();

    if (nowPlaying) {
      embed.addFields({
        name: "🎵 Now Playing",
        value: `**[${nowPlaying.title}](${nowPlaying.url})**\nBy ${nowPlaying.artist}`,
        inline: false,
      });
    }

    if (queue.length > 0) {
      const queueList = queue
        .slice(0, 10)
        .map(
          (song, index) =>
            `${index + 1}. **[${song.title}](${song.url})**\n   By ${
              song.artist
            }`
        )
        .join("\n\n");

      embed.addFields({
        name: `🎼 Up Next (${queue.length} songs)`,
        value:
          queueList +
          (queue.length > 10
            ? `\n\n...and ${queue.length - 10} more songs`
            : ""),
        inline: false,
      });
    }

    message.channel.send({
      embeds: [embed],
      components: nowPlaying ? [this.createMusicControls()] : [],
    });
  }

  async handleHelp(message) {
    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle("🎵 YK Music Bot - Universal Edition v4.0")
      .setDescription("**YouTube, Spotify & Playlist support!**")
      .addFields(
        {
          name: "🎵 Music Commands",
          value: `
                    \`yk play <song/url>\` - Play music
                    \`yk search <song>\` - Search and play  
                    \`yk skip\` or \`yk s\` - Skip current song
                    \`yk stop\` or \`yk x\` - Stop and clear queue
                    \`yk pause\` or \`yk pa\` - Pause music
                    \`yk resume\` or \`yk r\` - Resume music
                    `,
          inline: false,
        },
        {
          name: "📜 Queue Management",
          value: `
                    \`yk queue\` or \`yk q\` - Show queue
                    \`yk shuffle\` or \`yk sh\` - Shuffle queue
                    \`yk clear\` - Clear queue
                    \`yk remove <#>\` or \`yk rm <#>\` - Remove song
                    \`yk nowplaying\` or \`yk np\` - Current song info
                    `,
          inline: false,
        },
        {
          name: "🔗 Supported Links",
          value: `
                    **YouTube:**
                    • Single videos: \`youtube.com/watch?v=...\`
                    • Playlists: \`youtube.com/playlist?list=...\`
                    
                    **Spotify:**
                    • Songs: \`spotify.com/track/...\`
                    • Playlists: \`spotify.com/playlist/...\`
                    • Albums: \`spotify.com/album/...\`
                    `,
          inline: false,
        },
        {
          name: "🚀 New Features v4.0",
          value:
            "• Direct Spotify link support\n• YouTube playlist support\n• Improved audio streaming\n• Better error handling\n• Enhanced search results\n• Auto-skip on errors",
          inline: false,
        }
      )
      .setThumbnail(this.client.user.displayAvatarURL())
      .setFooter({ text: "YK Music v4.0 - Universal Music Bot" })
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  sendErrorEmbed(message, errorText) {
    const embed = new EmbedBuilder()
      .setColor(0xff4757)
      .setTitle("❌ Error")
      .setDescription(errorText)
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  createErrorEmbed(errorText) {
    return new EmbedBuilder()
      .setColor(0xff4757)
      .setTitle("❌ Error")
      .setDescription(errorText)
      .setTimestamp();
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "Unknown";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  async sendWelcomeMessage(guild) {
    const channel =
      guild.systemChannel ||
      guild.channels.cache.find(
        (ch) =>
          ch.type === 0 && // Text channel
          ch.permissionsFor(guild.members.me).has("SendMessages")
      );

    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x00ffcc)
      .setTitle("🎵 YK Music Bot v4.0 - Universal Edition!")
      .setDescription(
        `
                🎉 **The ultimate music bot with everything you need!**
                
                **🚀 New Features:**
                • YouTube videos & playlists support
                • Spotify tracks, albums & playlists support
                • Improved audio quality & reliability
                • Better error handling & auto-skip
                • Enhanced search capabilities
                
                **🎯 Quick Start:**
                • \`yk play <song name or any URL>\`
                • \`yk help\` - See all commands
                
                **Paste any link and enjoy!** 🎸
                YouTube, Spotify, Playlists - all supported!
            `
      )
      .setThumbnail(this.client.user.displayAvatarURL())
      .setFooter({ text: 'Type "yk help" for full command list' })
      .setTimestamp();

    channel.send({ embeds: [embed] });
  }

  handleVoiceStateUpdate(oldState, newState) {
    // Auto-disconnect when bot is alone in voice channel
    if (oldState.channelId && oldState.channel?.members.size === 1) {
      const connection = getVoiceConnection(oldState.guild.id);
      if (connection) {
        setTimeout(() => {
          if (oldState.channel?.members.size === 1) {
            connection.destroy();
            this.queues.delete(oldState.guild.id);
            this.nowPlaying.delete(oldState.guild.id);
            console.log(
              `🔌 Auto-disconnected from ${oldState.guild.name} - empty channel`
            );
          }
        }, 30000); // 30 seconds delay
      }
    }
  }

  // Additional command handlers
  async handleSearch(message, query) {
    await this.handlePlay(message, query);
  }

  async handlePause(message) {
    const player = this.getGuildPlayer(message.guild.id);

    if (!this.nowPlaying.has(message.guild.id)) {
      return this.sendErrorEmbed(message, "Nothing is currently playing");
    }

    player.pause();

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("⏸️ Music Paused")
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleResume(message) {
    const player = this.getGuildPlayer(message.guild.id);

    if (!this.nowPlaying.has(message.guild.id)) {
      return this.sendErrorEmbed(message, "Nothing is currently playing");
    }

    player.unpause();

    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle("▶️ Music Resumed")
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleShuffle(message) {
    const queue = this.getGuildQueue(message.guild.id);

    if (queue.length < 2) {
      return this.sendErrorEmbed(
        message,
        "Need at least 2 songs in queue to shuffle"
      );
    }

    // Fisher-Yates shuffle algorithm
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🔀 Queue Shuffled")
      .setDescription(`Shuffled ${queue.length} songs`)
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleRemove(message, index) {
    const queue = this.getGuildQueue(message.guild.id);

    if (!index || index < 1 || index > queue.length) {
      return this.sendErrorEmbed(
        message,
        "Please provide a valid song number (1-" + queue.length + ")"
      );
    }

    const removed = queue.splice(index - 1, 1)[0];

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("🗑️ Song Removed")
      .setDescription(`Removed **${removed.title}** from queue`)
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async handleNowPlaying(message) {
    const nowPlaying = this.nowPlaying.get(message.guild.id);

    if (!nowPlaying) {
      return this.sendErrorEmbed(message, "Nothing is currently playing");
    }

    const embed = this.createNowPlayingEmbed(nowPlaying);
    message.channel.send({
      embeds: [embed],
      components: [this.createMusicControls()],
    });
  }

  async handleClear(message) {
    const queue = this.getGuildQueue(message.guild.id);
    const cleared = queue.length;

    if (cleared === 0) {
      return this.sendErrorEmbed(message, "Queue is already empty");
    }

    queue.length = 0;

    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle("🧹 Queue Cleared")
      .setDescription(`Removed ${cleared} songs from queue`)
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }

  async sendQuickHelp(message) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("❓ Unknown Command")
      .setDescription("Type `yk help` for a full list of commands")
      .addFields({
        name: "Quick Commands",
        value: "`yk play <song/url>` • `yk skip` • `yk queue` • `yk help`",
      })
      .addFields({
        name: "💡 Pro Tip",
        value: "You can paste YouTube or Spotify links directly!",
      })
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }
}

// Start the bot
const bot = new YKMusicBot();

// Enhanced error handling
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error);
  // Don't exit the process, just log the error
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught exception:", error);
  // Don't exit the process, just log the error
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("🔄 Shutting down gracefully...");
  bot.client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🔄 Shutting down gracefully...");
  bot.client.destroy();
  process.exit(0);
});

module.exports = YKMusicBot;
