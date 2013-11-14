//github api
'use strict'
var when = require('when');

var GitHubApi = require('github');
var github = new GitHubApi({
	// required
	version: "3.0.0",
	// optional
	timeout: 5000,
	//debug: true
});

var mixin = require('node-mixin');

var fs = require('fs');

var client_id = '5283e94694c3f4d149a7', 
	client_secret = '4e32758f32e1e5b23ee4672ddf1861f51729c11f';

//console.log(__dirname);

function GitPress(user, repo){
	this.options = {
		user: user,
		repo: repo,
		cache: __dirname + '/cache/' + repo + '.' + user
	}
}

var defaultConf = {
	"docs"      : ["posts"],	
	"perpage"   : 10,
	"types"     : {
		"\\.(md||markdown)$"   : "markdown", 
		"\\.(js||css||json)$"  : "code",
		"\\.html?$"            : "html",
		".*"                   : "text"		
	},
	"title"		: "blog",
	"comment"	: "on"
};

GitPress.prototype.init = function(){
	var self = this,
		cache = self.options.cache;

	process.umask(0);
	if(!fs.existsSync(cache)){
		fs.mkdirSync(cache);
	}


	var reposFile = cache + '/.repos';
	if(fs.existsSync(reposFile)){
		var reposLog = fs.readFileSync(reposFile, {encoding: 'utf-8'}); 
		reposLog = JSON.parse(reposLog);

		if(Date.now() - reposLog.timeStamp < 144000){
			self.options.update = reposLog.data.updated_at;
		}
		//console.log('from cache-->');
	}

	var deferred = when.defer();
	if(!self.options.update){
		github.repos.get({
			user: self.options.user,
			repo: self.options.repo 
		}, function(err, res){
			if(!err){
				self.options.update = res.updated_at;

				fs.writeFile(reposFile, 
					JSON.stringify({data:res, timeStamp: Date.now()}), 
					{mode: 438});	

				deferred.resolve();
			}else{
				deferred.reject(err);
			}		
		});
	}else{
		deferred.resolve();
	}

	return deferred.promise.then(function(){
		return self.getContent('gitpress.json').then(function(res){
			var content = (new Function("return " + res.content))();
			
			//get tpl
			mixin(self.options, content);
			mixin(self.options, defaultConf);

			//console.log(self.options);

			return self.options;	
		});
	});
}

GitPress.prototype.markdown = function(text) {
	var deferred = when.defer(),
		self = this;

	github.markdown.render({text:text}, function(err, res){
		if(res){
			deferred.resolve(res.data);
		}else{
			deferred.reject(err);
		}
	});	

	return deferred.promise;
}

GitPress.prototype.getContent = function(path, sha) {
	var deferred = when.defer(),
		self = this;

	//use filecache

	var cacheFile = this.options.cache + '/' + encodeURIComponent(path);
	//console.log(path);
	try{
		if(fs.existsSync(cacheFile)){
			var content = fs.readFileSync(cacheFile, {encoding: 'utf-8'});
			content = JSON.parse(content);

			if(sha && content.data.sha == sha
				|| content.update == self.options.update){
				//console.log(content.data);
				deferred.resolve(content.data);
				return deferred.promise;
			}
		}	
	}catch(ex){}

	github.repos.getContent({
		user: this.options.user,
		repo: this.options.repo,
		path: path
	}, function(err, res){
		if(err){
			deferred.reject(err);
		}else{
			res.timeStamp = Date.now();

			if(res.type == 'file'){

				var content = new Buffer(res.content, 'base64').toString();
				var type = getType(self.options.types, res.name);
				//res.type = type;
				res.content = content;	

				if(type == 'markdown'){
					content = res.content.replace(/^(#+)?(.*)\n/, '$1 <a href="/~'
						+ res.path + '">$2</a>');
					
					press.markdown(content)
						.then(function(html){
							res.html = html;

							fs.writeFile(cacheFile, 
								JSON.stringify({data:res, update: self.options.update}), 
								{mode: 438});

							deferred.resolve(res);
					});

				}else if(type == 'code'){

					press.markdown('### [' + 
						res.name + '](' +
						res.url +')\n```\n' + res.content + '\n```')
						.then(function(html){
							res.html = html;
			
							fs.writeFile(cacheFile, 
								JSON.stringify({data:res, update: self.options.update}), 
								{mode: 438});

							deferred.resolve(res);
						});
				}else{
					res.html = res.content;

					fs.writeFile(cacheFile, 
						JSON.stringify({data:res, update: self.options.update}), 
						{mode: 438});

					deferred.resolve(res);
				}	
			}else{
				fs.writeFile(cacheFile, 
					JSON.stringify({data:res, update: self.options.update}), 
					{mode: 438});

				deferred.resolve(res);				
			}
		}
	});

	return deferred.promise;
}

GitPress.prototype.getList = function(docs){

	var deferred = when.defer();

	docs = docs || this.options.docs;
	
	var ret = [], promises = [], blob_promises = [];
	var self = this;

	for(var i = 0; i < docs.length; i++){
		var doc = docs[i];
		promises.push(self.getContent(doc));
	}

	when.settle(promises).then(function(list){
		for(var i = 0; i < list.length; i++){
			var res = list[i];
			if(res.state == 'fulfilled'){
				var doc = res.value;

				if(doc instanceof Array){
					for(var j = 0; j < doc.length; j++){
						var blob = doc[j];

						if(blob.type == 'file'){
							blob_promises.push(
								self.getContent(blob.path, blob.sha)
							);
						}
					}
				}else if(doc.type == 'file'){
					ret.push(doc);
				}
			}

		}

		if(blob_promises.length){
			when.all(blob_promises).then(function(list){
				ret.push.apply(ret, list);
				deferred.resolve(ret);
			}).otherwise(function(err){
				deferred.reject(err);
			});
		}else{
			deferred.resolve(ret);
		}
		
	}).otherwise(function(err){
		deferred.reject(err);
	});
	
	return deferred.promise;	
}

function getType(types, name){
	for(var type in types){
		var reg = new RegExp(type);
		if(reg.test(name)){
			return types[type];
		}
	}
}

GitPress.prototype.getContents = function(docs, page){
	if(docs && !(docs instanceof Array)){
		docs = [docs];
	}

	page = page || 1;

	var perpage = this.options.perpage,
		self = this;

	return this.getList(docs).then(function(list){
		var res = [];

		for(var i = 0; i < list.length; i++){
			var blob = list[i];
			if(blob.type){
				res.push({
					sha:  blob.sha,
					type: blob.type, 
					name: blob.name,
					path: blob.path,
					url: blob.html_url,
					content: blob.content,
					html: blob.html
				});
			}
		}

		res.sort(function(a,b){
			return a.name > b.name ? -1 : 1
		});

		return res.slice((page - 1) * perpage, page * perpage);
	});
}

//hack http send
var _send = github.httpSend;

github.httpSend = function(msg, block, callback){
	
	block.url += block.url.indexOf('?') > -1 ? '&' : '?';
	block.url += 'client_id=' + client_id + '&client_secret=' + client_secret;

	//console.log(block.method, block);

	return _send.apply(github, arguments);
}

module.exports = GitPress;

var press = new GitPress('akira-cn', 'blog');

/*press.markdown("abc\n<!--more-->\ndef").then(function(res){
	console.log(res.split(/\n\n\n\n/));
}).otherwise(function(err){
	console.log(err);
});*/

/*press.getContent('posts/2013-11-12-my-first-blog.md').then(function(res){
	console.log(res);
}).otherwise(function(err){
	console.log(err);
});*/

/*press.init().then(function(res){
	//console.log(res);
	return press.getContents('posts/2013-11-12-my-first-blog.md');
})
.then(function(res){
	console.log(res);
})
.otherwise(function(err){
	console.log(err);
});*/