const api_url = 'https://api.soundcloud.com'
const auth_url = 'https://api.soundcloud.com/oauth2/token'

const apiRequest = (method, url, auth, params, callback) => {

	params.client_id = settings.clientIds.soundcloud.client_id
	params.format = 'json'

	if (auth) params.oauth_token = settings.soundcloud.access_token

	let urlParameters = Object.keys(params).map((i) => typeof params[i] !== 'object' ? i+'='+params[i]+'&' : '' ).join('') // transforms to url format everything except objects

	if (!url.includes('https://')) url = api_url+url

	let requestOptions = { url: url+'?'+urlParameters, method: method, json: true}

	if (method !== 'GET') requestOptions.json = params

	request(requestOptions, (err, result, body) => {
		if (body && (body.error || body.errors)) callback(body.error || body.errors, body)
		else callback(err, body)
	})
	
}

const auth = (code, callback) => {

	apiRequest('POST', auth_url, false, {

		client_secret: settings.clientIds.soundcloud.client_secret,
		grant_type: 'authorization_code',
		redirect_uri: 'http://localhost',
		code: code

	}, (err, res) => {
		callback(err, res)
	})

}

const convertTrack = rawTrack => {
	return {
		'service': 'soundcloud',
		'title': removeFreeDL(rawTrack.title),
		'artist': {
			'id': rawTrack.user.id,
			'name': rawTrack.user.username
		},
		'album': {
			'id': '',
			'name': ''
		},
		'share_url': rawTrack.permalink_url,
		'id': rawTrack.id,
		'streamUrl': rawTrack.stream_url + "?client_id=" + settings.clientIds.soundcloud.client_id,
		'duration': rawTrack.duration,
		'artwork': rawTrack.artwork_url ? rawTrack.artwork_url.replace('large', 't67x67') : '' // For smaller artworks
	}
}

const removeFreeDL = (string) => {
	return string.replace("[Free DL]", "")
			.replace("(Free DL)", "")
			.replace("[Free Download]", "")
			.replace("(Free Download)", "")
			.replace("\"Free Download\"", "")
			.replace("(FREE DOWNLOAD)", "")
			.replace("[FREE DOWNLOAD]", "")

}


/**
* Soundcloud API Abstraction
*/
class Soundcloud {

	/**
	* Fetch data
	*
	* @returns {Promise}
	*/
	static fetchData (callback) {

		if (!settings.soundcloud.access_token) {
			settings.soundcloud.error = true
			return callback([null, true])
		}

		apiRequest('GET', '/me/favorites', true, { limit: 200, linked_partitioning: 1 }, (err, result) => {

			if (err) return callback([err])

			function moreTracks(url) {

				apiRequest('GET', url.split('soundcloud.com')[1], true, {}, (err, result) => {
					if (err) return callback([err])

					for (let tr of result.collection)
						if (typeof tr.stream_url !== "undefined")
							tempTracks.push(convertTrack(tr))

					if (result.next_href) moreTracks(result.next_href)
					else over()

				})
			}


			let tempTracks = []

			if (result) {
				for (let tr of result.collection)
					if (typeof tr.stream_url !== "undefined")
						tempTracks.push(convertTrack(tr))

				if (result.next_href) moreTracks(result.next_href)
				else over()
			}

			function over() {
				Data.addPlaylist({
					service: 'soundcloud',
					title: 'Liked tracks',
					id: 'favs',
					icon: 'heart',
					artwork: '',
					tracks: tempTracks
				})
			

				apiRequest('GET', '/me/activities', true, { limit: 200 }, (err, result) => {

					if (err) return callback([err])

					let tempTracks = []

					for (let i of result.collection) {
						const originNotValid = (i.origin === null || typeof i.origin.stream_url === "undefined")
						const isTrack = i.type === "track"
						const isShare = i.type == "track-sharing"
						const isRepost = i.type == "track-repost"

						if (!originNotValid && (isTrack || isShare || isRepost)) {
							tempTracks.push(convertTrack(i.origin))
						}
					}

					Data.addPlaylist({
						service: 'soundcloud',
						title: 'Feed',
						id: 'stream',
						icon: 'globe',
						artwork: '',
						tracks: tempTracks
					})

					apiRequest('GET', '/me/playlists/', true, { limit: 125 }, (err, result) => {
						
						if (err) return callback([err])

						for (let i of result) {
							let temp_tracks = []

							for (let t of i.tracks)
								if (typeof t.stream_url !== "undefined")
									temp_tracks.push(convertTrack(t))


							Data.addPlaylist({
								service: 'soundcloud',
								id: i.id,
								title: i.title,
								author: {
									name: i.user.username,
									id: i.user.id
								},
								artwork: i.artwork_url,
								canBeDeleted: true,
								editable: true,
								tracks: temp_tracks
							})

						}

						callback()
					})

				})
			}
		})
	}

	/**
	 * Called when user wants to activate the service
	 *
	 * @param callback {Function} Callback function
	 */
	static login (callback) {

		const oauthUrl = `https://soundcloud.com/connect?scope=non-expiring&client_id=${settings.clientIds.soundcloud.client_id}&redirect_uri=http://localhost&response_type=code&display=popup`
		oauthLogin(oauthUrl, (code) => {
			
			if (!code) return callback('stopped')

			auth( code, (err, data) => {
				if (err) return callback(err)

				settings.soundcloud.access_token = data.access_token

				callback()
			})

		})

	}

	/**
	 * Like a song
	 *
	 * @param track {Object} The track object
	 */
	static like (track, callback) {
		apiRequest('PUT', `/me/favorites/${track.id}`, true, {}, (err, result) => {
			callback(err)
		})
	}

	/**
	 * Unlike a track
	 *
	 * @param track {Object} The track object
	 */
	static unlike (track, callback) {
		apiRequest('DELETE', `/me/favorites/${track.id}`, true, {}, (err, result) => {
			callback(err)
		})
	}

	/**
	* Create a Playlist
	*
	* @param name {String} The name of the playlist to be created
	*/
	static createPlaylist (name, callback) {

		apiRequest('POST', '/me/playlists', true, {playlist: {title: name}}, (err, playlist) => {

			if (err) return callback(err)

			callback(null, {
				service: 'soundcloud',
				editable: true,
				canBeDeleted: true,
				author: {
					name: playlist.user.username,
					id: playlist.user.id
				},
				title: playlist.title,
				id: playlist.id,
				artwork: playlist.artwork_url,
				tracks: []
			})

		})

	}

	/**
	* Delete a Playlist (unfollowing it is Spotify's way)
	*
	* @param playlist {Object} The object of the playlist to be deleted
	*/
	static deletePlaylist (playlist, callback) {

		apiRequest('DELETE', `/me/playlists/${playlist.id}`, true, {}, (err, result) => {
		
			callback(err)

		})

	}

	/**
	* Add tracks to a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static addToPlaylist (tracks, playlistId, callback) {

		Data.findOne({service: 'soundcloud', id: playlistId}, (error, result) => {

			let playlistTracks = []

			for (let track of result.tracks)
				playlistTracks.push({id: track.id}) // Playlist was already modified

			apiRequest('PUT', `/me/playlists/${playlistId}`, true, { playlist: { "tracks": playlistTracks } }, (err, result) => {

				callback(err || error)

			})
		})

	}

	/**
	* Remove tracks from a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static removeFromPlaylist (tracks, playlistId, callback) {
		return this.addToPlaylist(tracks, playlistId, callback) // same as add
	}


	/**
	 * Gets a track's streamable URL
	 *
	 * @param track {Object} The track object
	 * @param callback {Function} The callback function
	 */
	static getStreamUrl (track, callback) {
		callback(null, track.stream_url + "?client_id=" + settings.clientIds.soundcloud.client_id, track.id)
	}

	/**
	* Gets a track's streamable URL, from it's base url
	*
	* @param url {String} The track object
	* @param callback {Function} The callback function
	*/
	static resolveTrack (url, callback) {
		apiRequest('GET', `/resolve`, false, {url: url}, (err, result)=> {
			callback(err, (!err && result) ? convertTrack(result) : null)
		})
	}

	/**
	* View a track's artist
	*
	* @param track {Object} The track object
	*/
	static viewArtist (tracks) {
		let track = tracks[0]

		specialView('soundcloud', 'loading', 'artist', track.artist.name)

		apiRequest('GET', `/users/${track.artist.id}`, true, {}, (err, result) => {

			if (err) return console.error(err)

			let image = result.avatar_url

			apiRequest('GET', `/users/${track.artist.id}/tracks`, true, {limit: 200}, (err, result) => {

				if (err) return console.error(err)

				let tracks = []

				for (let tr of result)
					if (typeof tr.stream_url != "undefined")
						tracks.push(convertTrack(tr))

				specialView('soundcloud', tracks, 'artist', track.artist.name, image)

			})
		})
	}

	/**
	 * Search
	 * @param query {String}: the query of the search
	 * @param callback
	 */
	static searchTracks (query, callback) {

		apiRequest('GET', `/tracks`, true, {q: encodeURI(query)}, (err, result) => {
			if (err) return console.error(err)

			let tracks = []

			for (let tr of result)
				if (typeof tr.stream_url != "undefined")
					tracks.push(convertTrack(tr))

			callback(tracks, query)

		})
	}

	/*
	* Returns the settings items of this plugin
	*
	*/
	static settingsItems () {
		return [
			{
				type: 'activate',
				id: 'active'
			}
		]
	}

	/*
	* Returns the context menu items of this plugin
	*
	* @param tracks {Array of Objects} The selected tracks object
	*/
	static contextmenuItems (tracks) {
		return [
			{
				label: 'View user',
				click: () => Soundcloud.viewArtist(tracks)
			}
		]
	}

}

/** Static Properties **/
Soundcloud.favsPlaylistId = "favs"
Soundcloud.scrobbling = true

Soundcloud.settings = {
	active: false
}

module.exports = Soundcloud