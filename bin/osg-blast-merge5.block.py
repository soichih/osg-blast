#!/usr/bin/python

import logging
import libxml2
import sys
import os
import glob
import resource

#setup logging
logger = logging.getLogger('osg-blast-merge5(xml).block')
logger.setLevel(logging.DEBUG)
ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
ch.setFormatter(formatter)
logger.addHandler(ch)

#default is 500 in blast - need to match with blast.opt(in setup.py and setup_userdb.py)
#increasing max_target_seqs increases virtual memory usage and causes batch manager to SIGKILL.
#NCBI article suggests to set ulimit, or use BATCH_SIZE env for now, let's set this to small 
#(compared to default 500) to workaround the memory issue
#http://www.ncbi.nlm.nih.gov/books/NBK1763/
max_target_seqs=500

#http://biopython.org/DIST/docs/tutorial/Tutorial.html#htoc82
#from Bio.Blast import NCBIXML
#result_handle = open("my_blast.xml")
#blast_record = NCBIXML.read(result_handle)

#blockname=sys.argv[1]
def merge(blockname):
    logger.info("merging query block "+blockname)
    template_doc = None

    #group all iterations on query definition
    queries = {}
    part=0
    while True:
        path = "output.qb_"+str(blockname)+".db_"+str(part)
        if not os.path.exists(path):
            break 

        #parse
        try:
            xml_file = open(path, "r")
            xml = xml_file.read() 
            doc = libxml2.parseDoc(xml)

            #use first doc as template
            if template_doc == None:
                template_doc = doc

            ctxt = doc.xpathNewContext()

            #pull queries
            iterations = ctxt.xpathEval("//Iteration")
            for iteration in iterations:
                query_id = iteration.xpathEval("Iteration_query-ID")[0].content
                #query_def = iteration.xpathEval("Iteration_query-def")[0].content
                if not query_id in queries.keys():
                    queries[query_id] = [iteration]
                else:
                    queries[query_id].append(iteration)

            usage = resource.getrusage(resource.RUSAGE_SELF)

            #this doesn't seem to help.. but
            ctxt.xpathFreeContext()
        except:
            logger.error("failed to parse:"+path+" -- skipping")

        xml_file.close()

        part+=1


    if template_doc == None:
        logger.error("no result for "+blockname)
        sys.exit(1)

    def getevalue(hit):
        first_hit = hit.xpathEval("Hit_hsps/Hsp")[0]
        evalue = first_hit.xpathEval("Hsp_evalue")[0].content

        return float(evalue)

    #merge all hits for each query and sort by evalue
    allhits_sorted = {}
    for query_id in queries.keys():
        iterations = queries[query_id] 
        allhits = []
        for iteration in iterations:
            hits = iteration.xpathEval("Iteration_hits/Hit")
            allhits += hits

        allhits.sort(key = getevalue)
        allhits_sorted[query_id] = allhits 

    ctxt = template_doc.xpathNewContext()

    #use template which contains list of queries and populate merged data
    iterations = ctxt.xpathEval("//Iteration")

    #insert hits back (upto -max-target_seqs)
    logger.info("adding hits")
    for iteration in iterations:
        query_id = iteration.xpathEval("Iteration_query-ID")[0].content

        #empty hits under iteration_hits
        hitsnode = iteration.xpathEval("Iteration_hits")[0]
        for hit in hitsnode.xpathEval("Hit"):
            hit.unlinkNode()

        #add real hits
        hitnum=1
        realhits = allhits_sorted[query_id]
        for hit in realhits:
            #reset hitnum
            hitnode = hit.xpathEval("Hit_num")[0]
            hitnode.setContent(str(hitnum))

            hitsnode.addChild(hit.copyNode(1))

            hitnum+=1
            #simulate default -max_target_seqs (=500) so that we don't get too many hits
            if hitnum > max_target_seqs:
                break

    #output 
    outpath = "merged.qb_"+str(blockname)
    #print outpath
    f = open(outpath, "w")
    template_doc.saveTo(f)

    #these doesn't help at all
    template_doc.freeDoc()
    ctxt.xpathFreeContext()
    #doc.freeDoc() #this causes segfault

    f.close()

    #remove all original results for this block (to save diskspace)
    #part=0
    #while True:
    #    path = "output/"+blockname+".db_"+str(part)+".result.gz"
    #    if not os.path.exists(path):
    #        break 
    #    print "removing",path
    #    os.remove(path)
    #    part+=1

merge(sys.argv[1]) 



