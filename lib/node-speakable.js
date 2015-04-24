var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    spawn = require('child_process').spawn,
    http = require('http');

var Speakable = function Speakable(credentials, options) {
  EventEmitter.call(this);

  options = options || {}

  this.recBuffer = [];
  this.infoBuffer = '';
  this.recRunning = false;
  this.apiResult = {};
  this.apiLang = options.lang || "en-US";
  this.apiKey = credentials.key
  this.cmd = 'sox';
  this.cmdArgs = [
    '-q',
    '-b','16',
    '-d','-t','flac','-',
    'rate','16000','channels','1',
    'silence','1','0.1',(options.threshold || '0.5')+'%','0.5','0.5',(options.threshold || '0.5')+'%',
    '-n', 'stat'
  ];
};

util.inherits(Speakable, EventEmitter);
module.exports = Speakable;

Speakable.prototype.postVoiceData = function() {
  var self = this;

  var lines = self.infoBuffer.split('\n');
  var info = {};
  for (var i in lines) {
    var line = lines[i].split(' ');
    if (line.length >= 2)
      info[line[0].trim().toLowerCase()] = line[line.length - 1].trim();
  }

  // abort if sample is less than 0.3 seconds
  if (parseFloat(info.length) < 0.3)
  {
    // discard data
    self.recBuffer = [];
    self.infoBuffer = '';
    return self.emit('error', 'Sample too short');
  }

  var options = {
    hostname: 'www.google.com',
    path: '/speech-api/v2/recognize?client=chromium&key=' + self.apiKey + '&maxresults=1&lang=' + self.apiLang,
    method: 'POST',
    headers: {
      'Content-Type': 'audio/x-flac; rate=16000',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.90 Safari/537.36'
    }
  };

  var req = http.request(options, function(res) {
    self.recBuffer = [];
    self.infoBuffer = '';
    if(res.statusCode !== 200) {
      return self.emit(
        'error',
        'Non-200 answer from Google Speech API (' + res.statusCode + ')'
      );
    }
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      self.apiResult = JSON.parse(chunk);
    });
    res.on('end', function() {
      self.parseResult();
    });
  });

  req.on('error', function(e) {
    self.emit('error', e);
  });

  // write data to request body
  console.log('Posting voice data...');
  for(var i in self.recBuffer) {
    if(self.recBuffer.hasOwnProperty(i)) {
      req.write(new Buffer(self.recBuffer[i],'binary'));
    }
  }
  req.end();
};

Speakable.prototype.recordVoice = function() {
  var self = this;

  var rec = spawn(self.cmd, self.cmdArgs, { stdio: 'pipe' });

  // Process stdout

  rec.stdout.on('readable', function() {
    self.emit('speechReady');
  });

  rec.stdout.setEncoding('binary');
  rec.stdout.on('data', function(data) {
    if(! self.recRunning) {
      self.emit('speechStart');
      self.recRunning = true;
    }
    self.recBuffer.push(data);
  });

  // Process stdin

  rec.stderr.setEncoding('utf8');
  rec.stderr.on('data', function(data) {
    //console.log(data);
    self.infoBuffer += data;
  });

  rec.on('close', function(code) {
    self.recRunning = false;
    if(code != 0) {
      return self.emit('error', 'sox exited with code ' + code);
    }
    self.emit('speechStop');
    self.postVoiceData();
  });
};

Speakable.prototype.resetVoice = function() {
  var self = this;
  self.recBuffer = [];
}

Speakable.prototype.parseResult = function() {
  var recognizedWords = [], apiResult = this.apiResult.result;
  if(apiResult && apiResult.length > 0 && apiResult[0].alternative && apiResult[0].alternative[0]) {
    recognizedWords = apiResult[0].alternative[0].transcript;
    this.emit('speechResult', recognizedWords);
  } else {
    this.emit('speechResult', []);
  }
}
