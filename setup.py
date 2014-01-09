#!/usr/bin/python

import sys
import os
import time
import shutil
import urllib
import re
import socket

if len(sys.argv) != 9:
    print "in correct number of arguments"
    sys.exit(1)

portalid=sys.argv[1]
project=sys.argv[2]
dbname=sys.argv[3]
dbver=sys.argv[4]
query_path=sys.argv[5]
blast_type=sys.argv[6]
user_blast_opt=sys.argv[7]
rundir=sys.argv[8]

block_size=600 #shooting for 1:00 - 1:30 runtime
#block_size=100 #shooting for 10 - 15 minutes

db_path = "http://osg-xsede.grid.iu.edu/scratch/iugalaxy/blastdb/"+dbname+"."+dbver
bin_path = "http://osg-xsede.grid.iu.edu/scratch/iugalaxy/blastapp/ncbi-blast-2.2.28+/bin"

os.mkdir(rundir+"/log")
os.mkdir(rundir+"/output")

inputdir=rundir+"/input"
os.makedirs(inputdir)

def write_block(count, block):
    outfile = open("%s/block_%d" % (inputdir, count), "w")
    for query in block:
        outfile.write(query[0])
        outfile.write(query[1])
    outfile.close()

#parse input query
input = open(query_path)
query_block = []
query = ""
block_count = 0
name = ""
for line in input.readlines():
    if line[0] == ">":
        if name != "":
            query_block.append([name, query])
            if len(query_block) == block_size:
                write_block(block_count, query_block)
                query_block = []
                block_count+=1
        name = line
        query = ""
    else:
        query += line
if name != "":
    query_block.append([name, query])
    write_block(block_count, query_block)
    query_block = []
    block_count+=1
input.close()

#list *.gz on the db_path
con = urllib.urlopen(db_path+"/list")
html = con.read()
con.close()
dbparts = []
for part in html.split("\n"):
    if part == "": 
        continue
    dbparts.append(part)

#print "#number of db parts", len(dbparts)

#I don't know how to pass double quote escaped arguments via condor arguemnts option
#so let's pass via writing out to file.
#we need to concat user blast opt to db blast opt
con = urllib.urlopen(db_path+"/blast.opt")
db_blast_opt = con.read().strip()
con.close()
blast_opt = file(rundir+"/blast.opt", "w")
blast_opt.write(db_blast_opt)
blast_opt.write(" "+user_blast_opt)

#increasing max_target_seqs increases virtual memory usage. NCBI article suggests to set ulimit, or use BATCH_SIZE env.
#for now, let's set this to small (compared to default 500) to workaround the memory issue
#http://www.ncbi.nlm.nih.gov/books/NBK1763/
#update on merge.py as well to match this (should be configurable..)
blast_opt.write(" -max_target_seqs 50") 

blast_opt.close()

dag = open(rundir+"/blast.dag", "w")
dag.write("CONFIG dagman.config\n\n")

shutil.copy("blast_wrapper.sh", rundir)
shutil.copy("merge.py", rundir)
shutil.copy("merge_final.py", rundir)
shutil.copy("dagman.config", rundir) #to increase DAGMAN_MAX_JOB_HOLDS (what was this again?)

subs = []
for dbnum in range(0, len(dbparts)):
    sub_name = "db_"+str(dbnum)
    subs.append(sub_name)
    sub = open(rundir+"/"+sub_name+".sub", "w")

    if socket.gethostname() == "osg-xsede.grid.iu.edu":
        sub.write("#for osg-xsede\n")
        sub.write("universe = vanilla\n") #for osg-xsede
    else:
        sub.write("universe = grid\n") #on bosco submit node (soichi6)

    sub.write("notification = never\n")
    sub.write("ShouldTransferFiles = YES\n")
    sub.write("when_to_transfer_output = ON_EXIT\n\n") #as oppose to ON_ALWAYS may transfer 0-byte result if job fails.. but we might want that?

    #cinvestav has an aweful outbound-squid bandwidth (goc ticket 17256)
    #crane is not production yet (#18017)
    sub.write("Requirements = (GLIDEIN_ResourceName =!= \"Nebraska\") && (GLIDEIN_ResourceName =!= \"cinvestav\") && (Memory >= 2000) \n") 

    sub.write("periodic_hold = ( ( CurrentTime - EnteredCurrentStatus ) > 14400) && JobStatus == 2\n")  #max 4 hours
    sub.write("periodic_release = ( ( CurrentTime - EnteredCurrentStatus ) > 60 )\n") #release after 60 seconds
    sub.write("on_exit_hold = (ExitBySignal == True) || (ExitCode != 0)\n\n") #stay in queue on failures

    sub.write("executable = blast_wrapper.sh\n")
    sub.write("output = log/db_"+str(dbnum)+".block_$(Process).$(Cluster).out\n")
    sub.write("error = log/db_"+str(dbnum)+".block_$(Process).$(Cluster).out\n") #mix out and err together..
    sub.write("log = log/db_"+str(dbnum)+".$(Cluster).log\n") #pull all processes together

    sub.write("+ProjectName = \""+project+"\"\n") #only works if submitted directly on osg-xsede (use ~/.xsede_default_project instead)
    sub.write("+PortalUser = \""+portalid+"\"\n")

    sub.write("transfer_output_files = output\n");

    #TODO - should I compress query block?
    sub.write("transfer_input_files = blast.opt,input/block_$(Process)\n")
    
    #arguments order
    #blast_path=$1
    #blast_type=$2
    #query_path=$3
    #db=$4
    #dburl=$5
    #part=$6
    #output_path=$7
    sub.write("arguments = "+bin_path+" "+blast_type+" block_$(Process) "+dbname+" "+db_path+" "+str(dbnum)+" output/block_$(Process).db_"+str(dbnum)+".result\n");

    #description to make condor_q looks a bit nicer
    sub.write("+Description = \""+blast_type+" "+dbname+" db_"+str(dbnum)+".block_$(Process).$(Cluster)\"\n")

    sub.write("\nqueue "+str(block_count)+"\n")
    sub.close()

    dag.write("JOB "+sub_name+" "+sub_name+".sub\n")
    dag.write("RETRY "+sub_name+" 10\n") #can I lower this?
    #dag.write("JOB "+query_block+".merge "+msub_name+"\n")
    #dag.write("PARENT "+query_block+" CHILD "+query_block+".merge\n")
    #dag.write("RETRY "+query_block+" 3\n")

dag.write("\n")

#output submit files to merge parts for all blocks (after all subs ends)
merge_subs = []
for query_block in os.listdir(inputdir):
    msub_name = query_block+".merge"
    merge_subs.append(msub_name)
    msub = open(rundir+"/"+msub_name+".sub", "w")
    msub.write("universe = local\n")
    msub.write("notification = never\n")
    msub.write("executable = merge.py\n")
    msub.write("arguments = "+query_block+"\n")
    msub.write("output = log/"+query_block+".merge.out\n")
    msub.write("error = log/"+query_block+".merge.out\n")
    msub.write("log = log/"+query_block+".merge.log\n")
    msub.write("queue\n")

    dag.write("JOB "+msub_name+" "+msub_name+".sub\n")
    dag.write("PARENT "+" ".join(subs)+" CHILD "+msub_name+"\n")
    dag.write("RETRY "+msub_name+" 3\n") 

    #limit to 10 merge at a time
    # http://research.cs.wisc.edu/htcondor/manual/v7.6/2_10DAGMan_Applications.html
    # section 2.10.6.4
    dag.write("CATEGORY "+msub_name+" merge\n")
    dag.write("MAXJOBS merge 10\n")

dag.write("\n")
        
#output final.sub to merge all block merged files into a single xml
fsub_name = "final.sub"
fsub = open(rundir+"/"+fsub_name, "w")
fsub.write("universe = local\n")
fsub.write("notification = never\n")
fsub.write("executable = merge_final.py\n")
fsub.write("arguments = "+rundir+"/output\n")
fsub.write("output = log/final.out\n")
fsub.write("error = log/final.out\n")
fsub.write("log = log/final.log\n")
fsub.write("queue\n")

#should I really do this?
dag.write("JOB final final.sub\n")
dag.write("PARENT "+" ".join(merge_subs)+" CHILD final\n")
dag.write("RETRY final 3\n")

dag.close()

