#!/usr/bin/python

import libxml2
import sys
import os
import glob

max_target_seqs=100 #default is 500 in blast - need to match with blast.opt

#http://biopython.org/DIST/docs/tutorial/Tutorial.html#htoc82
#from Bio.Blast import NCBIXML
#result_handle = open("my_blast.xml")
#blast_record = NCBIXML.read(result_handle)

blockname=sys.argv[1]

template_doc = None

#group all iterations on query definition
queries = {}
part=0
while True:
    path = "output/"+blockname+".part_"+str(part)+".result"
    if not os.path.exists(path):
        break 

    subpath = path.split("/")
    filename = subpath[-1]

    path_tokens = filename.split(".")
    query_id = path_tokens[0].split("_")[1]
    db_id = path_tokens[1].split("_")[1]
    #print "loading query:",query_id,"db:",db_id
    print "loading",path

    doc = libxml2.parseFile(path)

    #use first doc as template
    if template_doc == None:
        template_doc = doc

    iterations = doc.xpathEval("//Iteration")
    for iteration in iterations:
        query_id = iteration.xpathEval("Iteration_query-ID")[0].content
        #query_def = iteration.xpathEval("Iteration_query-def")[0].content
        if not query_id in queries.keys():
            queries[query_id] = [iteration]
        else:
            queries[query_id].append(iteration)

    part+=1

if template_doc == None:
    print "no result for ",blockname
    sys.exit(1)

def getevalue(hit):
    first_hit = hit.xpathEval("Hit_hsps/Hsp")[0]
    #print dir(first_hit)
    #sys.exit()
    evalue = first_hit.xpathEval("Hsp_evalue")[0].content
    #print evalue

    return float(evalue)

#merge all hits for each query and sort by evalue
allhits_sorted = {}
for query_id in queries.keys():
    iterations = queries[query_id] 
    print query_id
    print "merging",len(iterations),"iterations"
    allhits = []
    for iteration in iterations:
        hits = iteration.xpathEval("Iteration_hits/Hit")
        allhits += hits

    allhits.sort(key = getevalue)

    #debug
    #for hit in allhits:
    #    evalue = hit.xpathEval("Hit_hsps/Hsp/Hsp_evalue")[0].content
    #    print evalue 

    allhits_sorted[query_id] = allhits 

#use template which contains list of queries and populate merged data
iterations = template_doc.xpathEval("//Iteration")

#insert hits back (upto -max-target_seqs)
for iteration in iterations:
    query_id = iteration.xpathEval("Iteration_query-ID")[0].content
    print "adding hits for",query_id

    #create new iteration_hits node
    #hitsnode = iteration.xpathEval("Iteration_hits")[0]
    #hitsnode.unlinkNode()
    #hitsnode = libxml2.newNode("Iteration_hits")
    #iteration.addChild(hitsnode)

    #empty hits under iteration_hits
    hitsnode = iteration.xpathEval("Iteration_hits")[0]
    for hit in hitsnode.xpathEval("Hit"):
        hit.unlinkNode()

    #TODO - I should somehow aggregate iteration message and add it back later
    #if iteration.xpathEval("Iteration_message"):
    #    hitsmessage = iteration.xpathEval("Iteration_message")[0]
    #    hitsmessage.unlinkNode()

    #add real hits
    hitnum=1
    realhits = allhits_sorted[query_id]
    for hit in realhits:
        #reset hitnum
        hitnode = hit.xpathEval("Hit_num")[0]
        hitnode.setContent(str(hitnum))

        #print "\tbefore addig hit",hitnum,"\ttotal now:",len(hitsnode.xpathEval("Hit"))
        hitsnode.addChild(hit.copyNode(1))
        #print "\tadded - total now:",len(hitsnode.xpathEval("Hit"))

        hitnum+=1
        #simulate default -max_target_seqs (=500) so that we don't get too many hits
        if hitnum > max_target_seqs:
            break

    #hitsnode = iteration.xpathEval("Iteration_hits/Hit")

#output 
outpath = "output/"+blockname+".merged.xml"
print outpath
f = open(outpath, "w")
template_doc.saveTo(f)
f.close()


