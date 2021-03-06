var async    = require('async');
var sha1     = require('sha1');
var fs       = require('fs');
var co = require('co');
var _        = require('underscore');
var Q = require('q');
var contract = require('../tools/contract');

module.exports = function (node, auth, nodeURI) {
  
  this.graphs = function(req, res){

    var NB_BLOCKS = 2000;

    return co(function *() {
      var root = yield Q.nfcall(node.blockchain.block, 0);
      var current = yield Q.nfcall(node.blockchain.current);
      var json = yield Q.nfcall(node.blockchain.blocks, NB_BLOCKS, current.number - NB_BLOCKS + 1);
      var sp = root.parameters.split(':');
      var parameters = {
        "c":                parseFloat(sp[0]),
        "dt":               parseInt(sp[1]),
        "ud0":              parseInt(sp[2]),
        "sigDelay":         parseInt(sp[3]),
        "sigValidity":      parseInt(sp[4]),
        "sigQty":           parseInt(sp[5]),
        "sigWoT":           parseInt(sp[6]),
        "msValidity":       parseInt(sp[7]),
        "stepMax":          parseInt(sp[8]),
        "medianTimeBlocks": parseInt(sp[9]),
        "avgGenTime":       parseInt(sp[10]),
        "dtDiffEval":       parseInt(sp[11]),
        "blocksRot":        parseInt(sp[12]),
        "percentRot":       parseFloat(sp[13]),
        "nodeURI":          nodeURI
      };
      var medianTimes = [];
      var accelerations = [];
      var speed = [];
      var increments = [];
      var members = [];
      var certifications = [];
      var newcomers = [];
      var actives = [];
      var outputs = [];
      var outputsEstimated = [];
      var leavers = [];
      var excluded = [];
      var transactions = [];
      var nbDifferentIssuers = [];
      var difficulties = [];
      var blockchainTime = 0;
      json.forEach(function (block, index) {
        members.push(block.membersCount);
        certifications.push(block.certifications.length);
        newcomers.push(block.identities.length);
        actives.push(block.actives.length);
        leavers.push(block.leavers.length);
        excluded.push(block.excluded.length);
        transactions.push(block.transactions.length);
        medianTimes.push(block.medianTime);
        accelerations.push(block.time - block.medianTime);
        difficulties.push(block.powMin);
        increments.push(block.medianTime - (index ? json[index-1].medianTime : block.medianTime));
        // Accumulation of last medianTimeBlocks variation
        var acc = 0;
        for (var i = Math.max(0, index - parameters.dtDiffEval); i < index; i++) {
          acc += increments[i+1];
        }
        speed.push(acc / parameters.dtDiffEval);
        // Volume
        var outputVolume = 0;
        block.transactions.forEach(function (tx) {
          tx.outputs.forEach(function (out) {
            var amount = parseInt(out.split(':')[1]);
            outputVolume += amount;
          });
        });
        outputs.push(outputVolume);
        // Volume without money change
        var outputVolumeEstimated = 0;
        block.transactions.forEach(function (tx) {
          tx.outputs.forEach(function (out) {
            var sp = out.split(':');
            var recipient = sp[0];
            var amount = parseInt(sp[1]);
            if (tx.signatories.indexOf(recipient) == -1)
              outputVolumeEstimated += amount;
          });
        });
        outputsEstimated.push(outputVolumeEstimated);
        // Number of different issuers
        var issuers = [];
        for (var i = Math.max(0, index - 1 - parameters.blocksRot); i <= index - 1; i++) {
          issuers.push(json[i].issuer);
        }
        nbDifferentIssuers.push(_(issuers).uniq().length);
        blockchainTime = block.medianTime;
      });

      return {
        'startBlock': current.number - NB_BLOCKS,
        'current': current,
        'parameters': parameters,
        'blockchainTime': blockchainTime,
        'medianTimes': medianTimes,
        'speed': speed,
        'accelerations': accelerations,
        'medianTimeIncrements': increments,
        'certifications': certifications,
        'members': members,
        'newcomers': newcomers,
        'actives': actives,
        'leavers': leavers,
        'excluded': excluded,
        'outputs': outputs,
        'outputsEstimated': outputsEstimated,
        'transactions': transactions,
        'difficulties': difficulties,
        'nbDifferentIssuers': nbDifferentIssuers
      };
    })
      .then((json) => answer200(res, json)).catch(answer500);
  };

  function answer200(res, json) {
    res.setHeader('Content-type', 'application/json');
    res.send(200, json);
  }

  function answer500(err) {
    res.setHeader('Content-type', 'application/json');
    res.send(500, err);
  }

  function successOr500 (res) {
    res.setHeader('Content-type', 'application/json');
    return function (err, json) {
      if(err){
        res.send(500, err);
        return;
      }
      res.send(200, json);
    };
  }
  
  this.current = function(req, res){
    async.waterfall([
      function (next){
        node.hdc.amendments.current(function (err, am) {
          if(am){
            contract.getStack(am, node, next);
          }
          else next(null, []);
        });
      }
    ], function (err, amendments) {
      if(err){
        res.send(500, err);
        return;
      }

      amendments.forEach(function (am) {
        am.hash = sha1(am.raw).toUpperCase();
      });

      res.setHeader('Content-type', 'application/json');
      res.send(200, {
        amendments: amendments,
        auth: auth
      });
    });
  };
  
  this.pending = function(req, res){
    async.waterfall([
      function (next){
        node.hdc.amendments.current(function (err, am) {
          next(null, am ? am.number : -1);
        });
      },
      function (currentNumber, next){
        node.registry.amendment.proposed(currentNumber + 1, function (err, am) {
          next(null, am ? [am] : []);
        });
      },
    ], function (err, amendments) {
      if(err){
        res.send(500, err);
        return;
      }

      amendments.forEach(function (am) {
        am.hash = sha1(am.raw).toUpperCase();
      });

      res.setHeader('Content-type', 'application/json');
      res.send(200, {
        amendments: amendments,
        auth: auth
      });
    });
  };
  
  this.votes = function(req, res){
    node.hdc.amendments.votes.get(function (err, json) {
      if(err){
        res.send(500, err);
        return;
      }

      var numbers = [];
      _(json.amendments).each(function (hashes, num) {
        numbers.push({
          index: num,
          hashes: []
        });
        _(hashes).each(function (count, hash) {
          numbers[numbers.length-1].hashes.push({
            hash: hash,
            count: count
          });
        });
      });

      numbers.reverse();
      res.setHeader('Content-type', 'application/json');
      res.send(200, {
        numbers: numbers,
        auth: auth
      });
    });
  };

  return this;
}
