//Global variables, stored inside a single object (not the best, but whatever)
var globals = {width:document.getElementById("canvas").offsetWidth,
			   height: 450,
			   dataset: [],

			   teams: ["Central Pulse", "Northern Mystics", "Waikato Bay of Plenty Magic", "Southern Steel", "Canterbury Tactix",
			    	   "New South Wales Swifts", "Adelaide Thunderbirds", "Melbourne Vixens", "West Coast Fever", "Queensland Firebirds"],

			   	rounds: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]
			  };

init(0); //Starts the script

//First, lets bind the data from each season file into an array
function init(i) {
	var count = 0;
	globals.dataset[i] = [];

	d3.csv("data/" + (2008+i) + "-Table1.csv",
		function(d) {

			var isBye = false;
			if (d.Date.search("BYES") !== -1) {
				isBye = true;
			}

			//Byes are fairly useless, so we simply omit them (and decrease the count to prevent holes in the array)
			if (isBye) {
				count--;
			}
			else {
				globals.dataset[i][count] = {
					Season: (2008 + i),
					Round: +d.Round,
					Date: parseDate(d.Date, i),
					Time: parseTime(d, i),
					HomeTeam: d['Home Team'],
					Score: parseScore(d.Score, i),
					AwayTeam: d['Away Team'],
					Venue: d.Venue,
				};
			}
			count++;
		},
		function(error, d) {
			//Chain loading, to ensure we don't move on until everything is loaded in
			if (i === 5) process();
			else init(i+1);
		});
}

//Returns true if the match is at the quarter final (or beyond) point
function isEndRound(match) {
	return (match.Round > 14);
}

//Returns true if the match is from the 2009 dataset and went into extra time
function isExtraTime(match) {
	return (match.Score.Home_Full !== undefined);
}

//Returns true if the match is a bye
function isBye(match) {
	return (match.Teams !== undefined);
}

function hasTime(match) {
	return (match.Time !== undefined);
}

//Returns true if the given match is intercountry
function isInterCountry(match) {
	var indexA = globals.teams.indexOf(match.HomeTeam);
	var indexB = globals.teams.indexOf(match.AwayTeam);
	return (indexA < 5 && indexB > 4) || (indexB < 5 && indexA > 4);
}


//Need to strip out parentheses and whitespace, and turn the - character (encoded three possible ways) into a dividing space
//Also handles the special draw case in 2008, and the 2009 extra time cases
function parseScore(score, i) {
	var sc = {};
	var dsc = score.replace(/ /gi, "").replace("(", " ").replace("draw", "").replace(")","").replace(/â€“/gi, " ").replace(/–/gi, " ").replace("-", " ").split(" ");
	sc.Home = +dsc[0];
	sc.Away = +dsc[1];

	//Handle byes
	if (sc.Away !== sc.Away) {
		sc.Home = 0;
		sc.Away = 0;
	}

	//Handle special case for the 2009 dataset extra-time games
	if (i === 1 && dsc.length > 2) {
		sc.Home_Full = +dsc[2];
		sc.Away_Full = +dsc[3];
	}

	return sc;
}

//Parses the date - this mainly involves stripping out time data where appropriate,
//and converting the result to an object
function parseDate(date, i) {
	var d = date.replace(",").split(" ");
	return {
		year:    2008 + i,
		month:   d[2],
		day:     d[1],
		weekday: d[0],
	};
}

//Parses the time - this is stored in several different formats, so parsing is quite
//involved. In cases where time is unknown, return undefined
//Also note all times are local times, and in 24h military format (eg. 9 am = 0900, 9.30 pm = 2130)
function parseTime(match, i) {
	var time;
	if (i === 0) {
		time = match.Time.replace(":", "").split(" ");
	}
	if (i === 1) {
		time = match.Date.split(", ")[1].replace(":", "").split(" ");
	}
	if (i === 2) {
		return match.Date.split(" ")[3].replace(":", "");
	}

	//Time data only exists prior to 2011
	else if (i > 2) {
		return undefined;
	}

	var t = +time[0];
	if (time[1].search("p") !== -1)
		t += 1200;

	if (t < 1000)
		return "0" + t;
	else return t;
}

//Handles further pre-processing of data (to find all venues and rival matchups), then graphs the default data
function process() {
	processVenues();
	processMultiHomes();
	processRivals();
	defaultSetup();
	graph();
}

//Stores the list of all venues (as strings) in the globals object
function processVenues() {
	globals.venues = [];
	var count = 0;

	var i, j;

	for (i = 0; i < globals.dataset.length; i++) {
		for (j = 0; j < globals.dataset[i].length; j++) {
			var match = globals.dataset[i][j];
			var v = match.Venue;

			if (globals.venues.indexOf(v) === -1) {
				globals.venues[count++] = v;
			}
		}
	}

	globals.venues.sort();
}

//Stores the list of all teams with multiple home venues,
//And the list of all the home venues for a given team
function processMultiHomes() {
	globals.multis = [];
	var count = 0;

	var i, j;
	var teamVenues = globals.teams.slice(0);

	for (i = 0; i < globals.dataset.length; i++) {
		for (j = 0; j < globals.dataset[i].length; j++) {
			var match = globals.dataset[i][j];
			var v = match.Venue;

			var t = match.HomeTeam;
			var ind = globals.teams.indexOf(t);

			if (teamVenues[ind] === t) {
				teamVenues[ind] === [v];
			}

			//Make sure we don't add the same team multiple times
			else if (teamVenues[ind].length === 1 && teamVenues[ind][0] !== v) {
				globals.multis[count++] = t;
				teamVenues[ind][1] = v;
			}
			else if (teamVenues[ind].indexOf(v) === -1) {
				teamVenues[ind][teamVenues[ind].length] = v;
			}
		}
	}

	globals.teamVenues = teamVenues;
	globals.multis.sort();
}

//Sets up an array of "Rival" teams, annotates matches between rivals
//Also creates a list of all possible matchups, for filter purposes
function processRivals() {
	globals.rivals = [];
	globals.matchups = [];
	var count = 0;

	//First, we need to set up all the possible team matchings
	//we sort alphabetically so we dont end up with doubles
	//For matchup stats, all values are from the perspective of the first team listed
	var teamStats = [];
	var i, j, seasons;

	for (i = 0; i < globals.dataset.length; i++) {
		for (j = 0; j < globals.dataset[i].length; j++) {

			var match = globals.dataset[i][j];

			if (isBye(match))
				continue;
			var t = [match.HomeTeam, match.AwayTeam].sort();
			var c = globals.matchups.indexOf(t);

			//Add an entry if one doesn't already exist
			if (c === -1) {
				c = globals.matchups.length;
				globals.matchups[c] = t;
				teamStats[c] = {teams: t, wins: 0, losses: 0};
			}

			var isWin = false;
			var homeWon = (match.Score.Home > match.Score.Away);
			if ((t[0] === match.HomeTeam) == homeWon) isWin = true;

			if (isWin) teamStats[c].wins++;
			else teamStats[c].losses++;
		}
	}

	//Now figure out which matchups are rivalries (at least a quarter of all matches lost by 'superior' team)
	for (i = 0; i < teamStats.length; i++) {
		var matchup = teamStats[i];
		var sum = matchup.wins + matchup.losses;
		var isWinner = (matchup.wins > matchup.losses);

		var isRival = (isWinner && matchup.losses > sum/4) || (!isWinner && matchup.wins > sum/4);
		if (isRival) {
			matchup.isWinner = isWinner;
			globals.rivals[count++] = matchup;
		}
	}
}

//Encodes a default setup - total score as the attractor, no repulsor, season as the time scale, no filters
function defaultSetup() {

	var result = {};
	result.attractor = "Sum";
	result.repulsor = "None";
	result.timeScale = "Season";
	result.time = 0;
	result.filters = {};

	globals.setup = result;

	document.getElementById("Attractors").value = "Sum";
	document.getElementById("Repulsors").value = "None";
	document.getElementById("Time").value = "Season";
	document.getElementById("Scale").value = 0;
}

function setupNodes(timeScale) {

	var nodes  = [];
	var count  = 0;
	var counts = [];
	var i, j;

	if (timeScale === "None") {

		for (i = 0; i < globals.dataset.length; i++) {
			for (j = 0; j < globals.dataset[i].length; j++) {
				nodes[count++] = globals.dataset[i][j];
				nodes[count-1].radius = setRadius(nodes[count-1]);
			}
		}
	}

	else if (timeScale === "Season") {
		for (i = 0; i < globals.dataset.length; i++) {
			for (j = 0; j < globals.dataset[i].length; j++) {

				var season = globals.dataset[i][j].Season - 2008;
				if (nodes[season] === undefined) {
					nodes[season] = [];
					counts[season] = 0;
				}
				nodes[season][counts[season]] = globals.dataset[i][j];
				nodes[season][counts[season]].radius = setRadius(nodes[season][counts[season]]);
				counts[season] += 1;
			}
		}
	}

	else if (timeScale === "Round") {
		for (i = 0; i < globals.dataset.length; i++) {
			for (j = 0; j < globals.dataset[i].length; j++) {

				var round = globals.dataset[i][j].Round - 1;
				if (nodes[round] === undefined) {
					nodes[round] = [];
					counts[round] = 0;
				}
				nodes[round][counts[round]] = globals.dataset[i][j];
				nodes[round][counts[round]].radius = setRadius(nodes[round][counts[round]]);
				counts[round] += 1;
			}
		}
	}

	return nodes;
}

//Filters out elements of the dataset
function filter(nodes, filters) {
	return nodes;
}

function setupForces(nodes) {
	var i;
	var forces = [];
	if (nodes[0][0] === undefined) {
		return d3.layout.force()
					.gravity(0.001)
					.charge(0)
					.nodes(nodes)
					.size([globals.width, globals.height]);
	}

	else {
		for (i = 0; i < nodes[0].length; i++) {
			forces[i] = d3.layout.force()
						.gravity(0.001)
						.charge(0)
						.nodes(nodes[i])
						.size([globals.width, globals.height]);
		}
	}
	return forces;
}

function graph() {

	var nodes = setupNodes(globals.setup.timeScale);
	nodes = filter(nodes, globals.setup.filters);

	var data = (nodes[0][0] === undefined) ? nodes : nodes[globals.setup.time];

	var forces = setupForces(nodes);

	var force =  (forces[0] === undefined) ? forces : forces[globals.setup.time];

	var maxR = d3.max(data, function(d){return (d.Score.Home+d.Score.Away)/6;});

	force.start();
	force.stop();

	var svg =  d3.select("body").select(".graph").select("#canvas").select("svg");

	svg.selectAll("circle")
						.data(data)
					.enter().append("circle")
						.attr("r", function(d, i) {return data[i].radius})
						.style("fill", setColour)
						.on("click", displayData, false)
						.on("mousedown", function() {d3.event.cancelBubble = true;});

	globals.data = data;
	globals.forces = forces;
	globals.nodes = nodes;
	globals.svg = svg;
	globals.maxR = maxR;

	doCollide();

	//Add magnet controls
	svg.on("mousedown",function() {doDown(d3.mouse(this));}, false);
	document.addEventListener("mouseup", doUp, true);
}

function graphTime() {
	var data = globals.nodes[globals.setup.time];
	var force = globals.forces[globals.setup.time];

	force.start();
	force.stop();

	var svg = globals.svg;

	svg.selectAll("circle").remove();
	svg.selectAll("circle")
						.data(data)
					.enter().append("circle")
						.attr("r", function(d, i) {return data[i].radius})
						.style("fill", setColour)
						.on("click", displayData, false)
						.on("mousedown", function() {d3.event.cancelBubble = true;});

	globals.data = data;
	doCollide();
}

function doCollide() {
	var data = globals.data;
	var maxR = globals.maxR;
	var svg = globals.svg;

	var q = d3.geom.quadtree(data),
    i = 0,
    n = data.length;

 	for (i = 0; i < n; i++) {
  		q.visit(collide(data[i], maxR));
  	}
  		

  	svg.selectAll("circle")
   		.attr("cx", function(d) { return d.x; })
   		.attr("cy", function(d) { return d.y; });
}

function setRadius(data, index) {
	return (data.Score.Home + data.Score.Away)/10;
}

function setColour(data, index) {
	if (data.Score.Home >= data.Score.Away)
		return "steelblue";
	else return "forestgreen";
}

function displayData(data, index) {
	console.log(data);
	document.getElementById("Round").innerHTML = "<u>Round:</u>   " + data.Round;
	document.getElementById("Date").innerHTML = "<u>Date:</u>   " + displayDate(data.Date);
	document.getElementById("Home").innerHTML = "<u>Home Team:</u>   " + data.HomeTeam;
	document.getElementById("Away").innerHTML = "<u>Away Team:</u>   " + data.AwayTeam;
	document.getElementById("Score").innerHTML = "<u>Round:</u>   " + displayScore(data.Score);
	document.getElementById("Venue").innerHTML = "<u>Venue:</u>   " + data.Venue;
}

function displayDate(date) {
	return date.day + "/" + date.month + "/" + date.year;
}

function displayScore(score) {
	return score.Home + " - " + score.Away;
}

//I take no credit for this: it comes from the collision detection example from the d3js website
//Of course, variables have been tweaked to fit my needs
function collide(node, maxR) {
  var r = node.radius + maxR,
      nx1 = node.x - r,
      nx2 = node.x + r,
      ny1 = node.y - r,
      ny2 = node.y + r;
  return function(quad, x1, y1, x2, y2) {
    if (quad.point && (quad.point !== node)) {
      var x = node.x - quad.point.x,
          y = node.y - quad.point.y,
          l = Math.sqrt(x * x + y * y),
          r = node.radius + quad.point.radius;
      if (l < r) {
        l = (l - r) / l * .5;
        node.x -= x *= l;
        node.y -= y *= l;
        quad.point.x += x;
        quad.point.y += y;
      }
    }

    if (node.y-maxR < 0) {
		node.y = maxR;
	}
		
	if (node.y+maxR > globals.height) {
		node.y = globals.height-maxR;
	}

	if (node.x-maxR < 0) {
		node.x = maxR;
	}

	if (node.x+maxR > globals.width) {
		node.x = globals.width-maxR;
	}

    return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
  };
}

function doDown(mouse) {
	magnetize(mouse);
	globals.interval = setInterval(function() {magnetize(mouse);}, 50);
}

function doUp() {
	if (globals.interval !== undefined)
		clearInterval(globals.interval);
}

function magnet(node, type) {

	var result; 

	if (type === "None")
		return 0;

	if (type === "Sum") {
		result = node.Score.Home + node.Score.Away;
	}

	if (type === "Win") {
		result = (node.Score.Home > node.Score.Away) ? node.Score.Home : node.Score.Away;
	}

	if (type === "Lose") {
		result = (node.Score.Home > node.Score.Away) ? node.Score.Away : node.Score.Home;
	}

	if (type === "Diff") {
		result = (node.Score.Home > node.Score.Away) ? (node.Score.Home-node.Score.Away) : (node.Score.Away-node.Score.Home);
	}

	return result;
}

function magnetize(mouse) {

	var attract = globals.setup.attractor;
	var repulse = globals.setup.repulsor;

	var x = mouse[0], y= mouse[1];
	var data = globals.data;
	var i, min = [], max = [], curs = [];

	for (i = 0; i < data.length; i++) {
		curs[i] = []
		curs[i][0] = magnet(data[i], attract);
		curs[i][1] = magnet(data[i], repulse);

		if (min[0] === undefined || curs[i][0] < min[0]) {
			min[0] = curs[i][0];
		}
		if (min[1] === undefined || curs[i][1] < min[1]) {
			min[1] = curs[i][1];
		}
		if (max[0] === undefined || curs[i][0] > max[0]) {
			max[0] = curs[i][0];
		}
		if (max[1] === undefined || curs[i][1] > max[1]) {
			max[1] = curs[i][1];
		}
	}

	//At most, can move 80px towards/away (in x and y directions) a second, which is 5px every call
	var aScale = d3.scale.linear()
					.domain([min[0], max[0]])
					.range([0, 5]);

	var rScale = d3.scale.linear()
					.domain([min[1], max[1]])
					.range([0, 5]);

	var node, sum, prev;

	for (i = 0; i < data.length; i++) {
		node = data[i];

		sum = aScale(curs[i][0]) - rScale(curs[i][1]);
		prev = node.x;

		node.x = (node.x < x) ? (node.x + sum) : (node.x - sum);

		if (sum > 0 && prev === x)
			node.x = x;

		else if ((prev < x && node.x > x )|| (prev > x && node.x < x)) {
			node.x = x;
		}

		prev = node.y;
		node.y = (node.y < y) ? (node.y + sum) : (node.y - sum);

		if (sum > 0 && prev === y)
			node.y = y;

		else if ((prev < y && node.y > y )|| (prev > y && node.y < y)) {
			node.y = y;
		}
	}
	
	doCollide();
}

function setAttract() {
	globals.setup.attractor = document.getElementById("Attractors").value;
} 


function setRepulse() {
	globals.setup.repulsor = document.getElementById("Repulsors").value;
}

function changeTime() {
	globals.setup.time = document.getElementById("Scale").value;
	graphTime();
}

function changeTimeScale() {
	globals.setup.timeScale = document.getElementById("Time").value;

	var slider = document.getElementById("Scale");
	var label = document.getElementById("ScaleLabel");

	if (globals.setup.timeScale === "None") {
		label.innerHTML = "";
		slider.max = 0;
		slider.disabled = true;
	}

	else {
		label.innerHTML = globals.setup.timeScale + ": ";
	}

	if (globals.setup.timeScale === "Season") {
		slider.max = 5;
		slider.disabled = false;
	}
	if (globals.setup.timeScale === "Round") {
		slider.max = 16;
		slider.disabled = false;
	}

	slider.value = 0;
	globals.svg.selectAll("circle").remove();
	graph();
}